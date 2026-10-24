//! Read-only semantic projection from the same snapshot as confirmed match rows.

use momo_analysis_core::achievements::{
    AchievementInput, Claim, ClaimKind, ClaimState, Definition, EventComposition, MAXIMUM_ITEMS,
    ManualRetirementSource, RetiredAchievement, RuleKind,
};
use tokio_postgres::Transaction;

use super::InputRepositoryError;

const fn invalid() -> InputRepositoryError {
    InputRepositoryError::InputContract("achievement catalog or durable evidence is invalid")
}

pub(super) async fn load(
    tx: &Transaction<'_>,
    title: &str,
) -> Result<AchievementInput, InputRepositoryError> {
    let item_limit = i64::try_from(MAXIMUM_ITEMS).map_err(|_error| invalid())? + 1;
    let root_limit = item_limit * 8;
    let member_ids = tx
        .query(
            "SELECT legacy_id FROM members ORDER BY legacy_id LIMIT 5",
            &[],
        )
        .await?
        .iter()
        .map(|row| row.try_get(0))
        .collect::<Result<Vec<String>, _>>()?;
    let map_master_ids = tx.query("SELECT legacy_id FROM map_masters WHERE game_title_id=(SELECT id FROM game_titles WHERE legacy_id=$1) ORDER BY legacy_id LIMIT $2", &[&title, &item_limit]).await?
        .iter().map(|row| row.try_get(0)).collect::<Result<Vec<String>, _>>()?;
    Ok(AchievementInput {
        member_ids,
        map_master_ids,
        definitions: definitions(tx, title, item_limit).await?,
        claims: claims(tx, title, root_limit).await?,
        event_compositions: event_compositions(tx, title).await?,
        retired_achievements: retired_achievements(tx, title, item_limit).await?,
        retired_manual_sources: retired_manual_sources(tx, title, root_limit).await?,
    })
}

async fn definitions(
    tx: &Transaction<'_>,
    title: &str,
    item_limit: i64,
) -> Result<Vec<Definition>, InputRepositoryError> {
    let rows = tx.query(r"SELECT a.id::text, a.stars, a.rule_kind, a.threshold::text,
        a.scope_kind='common', a.applies_from::text, a.retired_at IS NOT NULL, a.fixed_key,
        ARRAY(SELECT m.legacy_id FROM achievement_item_maps aim JOIN map_masters m ON m.id=aim.map_master_id WHERE aim.item_id=a.id ORDER BY m.legacy_id)
        FROM achievement_items a WHERE a.game_title_id=(SELECT id FROM game_titles WHERE legacy_id=$1)
        ORDER BY a.id LIMIT $2", &[&title, &item_limit]).await?;
    rows.iter()
        .map(|row| {
            let rule = row.try_get::<_, &str>(2)?;
            let rule_kind = match rule {
                "manual" => RuleKind::Manual,
                "total_assets" => RuleKind::TotalAssets,
                "destination" => RuleKind::Destination,
                "suri_no_ginji" => RuleKind::SuriNoGinji,
                "event_average_rank" => RuleKind::EventAverageRank,
                _ => return Err(invalid()),
            };
            Ok(Definition {
                achievement_id: row.try_get(0)?,
                stars: u8::try_from(row.try_get::<_, i32>(1)?).map_err(|_error| invalid())?,
                rule_kind,
                threshold: row.try_get(3)?,
                common: row.try_get(4)?,
                applies_from: row.try_get(5)?,
                retired: row.try_get(6)?,
                fixed_key: row.try_get(7)?,
                map_master_ids: row.try_get(8)?,
            })
        })
        .collect()
}

async fn claims(
    tx: &Transaction<'_>,
    title: &str,
    root_limit: i64,
) -> Result<Vec<Claim>, InputRepositoryError> {
    let rows = tx.query(r#"SELECT c.id::text, c.item_id::text, m.legacy_id, c.source_kind, c.state,
        c.generation_id::text, to_char(c.achieved_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'), game.legacy_id
        FROM achievement_claims c JOIN achievement_items a ON a.id=c.item_id
        JOIN members m ON m.id=c.member_id LEFT JOIN matches game ON game.id=c.match_id
        WHERE a.game_title_id=(SELECT id FROM game_titles WHERE legacy_id=$1)
        ORDER BY c.id LIMIT $2"#, &[&title, &root_limit]).await?;
    rows.iter()
        .map(|row| {
            let source_kind = match row.try_get::<_, &str>(3)? {
                "direct" => ClaimKind::Direct,
                "import" => ClaimKind::Import,
                _ => return Err(invalid()),
            };
            let state = match row.try_get::<_, &str>(4)? {
                "achieved" => ClaimState::Achieved,
                "unconfirmed" => ClaimState::Unconfirmed,
                "cancelled" => ClaimState::Cancelled,
                _ => return Err(invalid()),
            };
            Ok(Claim {
                claim_id: row.try_get(0)?,
                achievement_id: row.try_get(1)?,
                member_id: row.try_get(2)?,
                source_kind,
                state,
                generation_id: row.try_get(5)?,
                achieved_at: row.try_get(6)?,
                match_id: row.try_get(7)?,
            })
        })
        .collect()
}

async fn event_compositions(
    tx: &Transaction<'_>,
    title: &str,
) -> Result<Vec<EventComposition>, InputRepositoryError> {
    let rows = tx.query(r"SELECT held.legacy_id, count(*)::bigint, count(DISTINCT m.game_title_id)::bigint
        FROM matches m JOIN held_events held ON held.id=m.held_event_id
        WHERE m.held_event_id IN (SELECT held_event_id FROM matches WHERE game_title_id=(SELECT id FROM game_titles WHERE legacy_id=$1))
        GROUP BY held.id ORDER BY held.legacy_id LIMIT 25001", &[&title]).await?;
    rows.iter()
        .map(|row| {
            Ok(EventComposition {
                held_event_id: row.try_get(0)?,
                match_count: u32::try_from(row.try_get::<_, i64>(1)?)
                    .map_err(|_error| invalid())?,
                title_count: u32::try_from(row.try_get::<_, i64>(2)?)
                    .map_err(|_error| invalid())?,
            })
        })
        .collect()
}

async fn retired_achievements(
    tx: &Transaction<'_>,
    title: &str,
    item_limit: i64,
) -> Result<Vec<RetiredAchievement>, InputRepositoryError> {
    let rows = tx.query(r"SELECT s.item_id::text, s.format_version,
        CASE WHEN octet_length(s.snapshot::text)<=1048576 THEN s.snapshot->'players' ELSE NULL END
        FROM achievement_retired_snapshots s JOIN achievement_items a ON a.id=s.item_id
        WHERE a.game_title_id=(SELECT id FROM game_titles WHERE legacy_id=$1) ORDER BY s.item_id LIMIT $2", &[&title, &item_limit]).await?;
    rows.iter()
        .map(|row| {
            if row.try_get::<_, i32>(1)? != 1 {
                return Err(invalid());
            }
            let players = row
                .try_get::<_, Option<serde_json::Value>>(2)?
                .ok_or_else(invalid)?;
            Ok(RetiredAchievement {
                achievement_id: row.try_get(0)?,
                players: serde_json::from_value(players).map_err(|_error| invalid())?,
            })
        })
        .collect()
}

async fn retired_manual_sources(
    tx: &Transaction<'_>,
    title: &str,
    root_limit: i64,
) -> Result<Vec<ManualRetirementSource>, InputRepositoryError> {
    let rows = tx
        .query(
            r"SELECT s.item_id::text,s.claim_id::text,s.generation_id::text
        FROM achievement_retired_manual_sources s JOIN achievement_items a ON a.id=s.item_id
        WHERE a.game_title_id=(SELECT id FROM game_titles WHERE legacy_id=$1)
        ORDER BY s.item_id,s.claim_id,s.generation_id LIMIT $2",
            &[&title, &root_limit],
        )
        .await?;
    rows.iter()
        .map(|row| {
            Ok(ManualRetirementSource {
                achievement_id: row.try_get(0)?,
                claim_id: row.try_get(1)?,
                generation_id: row.try_get(2)?,
            })
        })
        .collect::<Result<Vec<_>, tokio_postgres::Error>>()
        .map_err(InputRepositoryError::from)
}
