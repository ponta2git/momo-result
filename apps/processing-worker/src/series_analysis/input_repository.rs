use futures_util::TryStreamExt;
use momo_analysis_core::model::{
    AnalysisInput, IncidentCounts, NormalizedAnalysisInput, PlayerMatchInput,
};
use thiserror::Error;
use tokio_postgres::{Client, IsolationLevel, Row};

// This is deliberately well above the release resource fixture (500 matches / 2,000 rows).
// The child process hard limit remains the authoritative memory bound for unexpectedly large
// snapshots; this row cap prevents unbounded input independently of a deployment-specific limit.
const MAXIMUM_INPUT_ROWS: usize = 100_000;
const MAXIMUM_INPUT_ID_BYTES: usize = 128;
const ANALYSIS_INPUT_QUERY: &str = r#"SELECT
       m.id, m.analysis_revision,
       to_char(m.played_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
       m.held_event_id, m.match_no_in_event,
       m.season_master_id, m.map_master_id,
       mp.member_id, mp.play_order, mp.rank,
       mp.total_assets_man_yen, mp.revenue_man_yen,
       COALESCE(SUM(mi.count) FILTER (WHERE mi.incident_master_id = 'incident_destination'), 0)::int,
       COALESCE(SUM(mi.count) FILTER (WHERE mi.incident_master_id = 'incident_plus_station'), 0)::int,
       COALESCE(SUM(mi.count) FILTER (WHERE mi.incident_master_id = 'incident_minus_station'), 0)::int,
       COALESCE(SUM(mi.count) FILTER (WHERE mi.incident_master_id = 'incident_card_station'), 0)::int,
       COALESCE(SUM(mi.count) FILTER (WHERE mi.incident_master_id = 'incident_card_shop'), 0)::int,
       COALESCE(SUM(mi.count) FILTER (WHERE mi.incident_master_id = 'incident_suri_no_ginji'), 0)::int
     FROM matches m
     JOIN match_players mp ON mp.match_id = m.id
     LEFT JOIN match_incidents mi ON mi.match_id = mp.match_id AND mi.member_id = mp.member_id
     WHERE m.game_title_id = $1
     GROUP BY m.id, m.analysis_revision, m.played_at, m.held_event_id,
       m.match_no_in_event, m.season_master_id,
       m.map_master_id, mp.member_id, mp.play_order, mp.rank,
       mp.total_assets_man_yen, mp.revenue_man_yen
     ORDER BY m.played_at, m.held_event_id, m.match_no_in_event, m.id, mp.play_order
     LIMIT $2"#;

#[derive(Debug, Error)]
pub(super) enum InputRepositoryError {
    #[error("PostgreSQL operation failed")]
    Postgres(#[from] tokio_postgres::Error),
    #[error("analysis title does not exist")]
    TitleNotFound,
    #[error("analysis input revision was superseded")]
    Superseded,
    #[error("analysis input violates the fixed-match contract: {0}")]
    InputContract(&'static str),
}

/// Loads all calculation input from one repeatable-read, read-only snapshot.
///
/// Mutable display metadata is intentionally not loaded into the calculation snapshot.
///
/// # Errors
///
/// Returns [`InputRepositoryError::Superseded`] before calculation when the leased revision is
/// stale.
pub(super) async fn load_analysis_input(
    client: &mut Client,
    game_title_id: &str,
    expected_revision: i64,
) -> Result<NormalizedAnalysisInput, InputRepositoryError> {
    let transaction = client
        .build_transaction()
        .isolation_level(IsolationLevel::RepeatableRead)
        .read_only(true)
        .start()
        .await?;
    transaction
        .batch_execute("SET LOCAL TIME ZONE 'UTC'")
        .await?;
    let title = transaction
        .query_opt(
            "SELECT s.input_revision \
             FROM game_titles gt \
             JOIN series_analysis_title_states s ON s.game_title_id = gt.id \
             WHERE gt.id = $1",
            &[&game_title_id],
        )
        .await?
        .ok_or(InputRepositoryError::TitleNotFound)?;
    let input_revision = title.try_get::<_, i64>(0)?;
    if input_revision != expected_revision {
        return Err(InputRepositoryError::Superseded);
    }

    let expected_player_match_count = validate_input_shape(&transaction, game_title_id).await?;

    let query_limit = i64::try_from(MAXIMUM_INPUT_ROWS)
        .map_err(|_conversion_error| {
            InputRepositoryError::InputContract("input row bound is unsupported")
        })?
        .checked_add(1)
        .ok_or(InputRepositoryError::InputContract(
            "input row bound is unsupported",
        ))?;
    let parameters: [&(dyn tokio_postgres::types::ToSql + Sync); 2] =
        [&game_title_id, &query_limit];
    let rows = transaction
        .query_raw(ANALYSIS_INPUT_QUERY, parameters)
        .await?;
    tokio::pin!(rows);
    let mut player_matches = Vec::with_capacity(expected_player_match_count);
    while let Some(row) = rows.try_next().await? {
        player_matches.push(player_match_from_database(&row)?);
    }
    if player_matches.len() != expected_player_match_count {
        return Err(InputRepositoryError::InputContract(
            "input snapshot row count changed inside a repeatable-read transaction",
        ));
    }
    let input = AnalysisInput {
        game_title_id: String::from(game_title_id),
        input_revision,
        player_matches,
    }
    .into_normalized();
    validate_player_matches(&input.player_matches)?;
    transaction.commit().await?;
    Ok(input)
}

async fn validate_input_shape(
    transaction: &tokio_postgres::Transaction<'_>,
    game_title_id: &str,
) -> Result<usize, InputRepositoryError> {
    let row = transaction
        .query_one(
            r"SELECT COUNT(*)::bigint,
                      COALESCE(MAX(octet_length(m.id)), 0)::int,
                      COALESCE(MAX(octet_length(m.held_event_id)), 0)::int,
                      COALESCE(MAX(octet_length(m.season_master_id)), 0)::int,
                      COALESCE(MAX(octet_length(m.map_master_id)), 0)::int,
                      COALESCE(MAX(octet_length(mp.member_id)), 0)::int
               FROM matches m
               JOIN match_players mp ON mp.match_id = m.id
               WHERE m.game_title_id = $1",
            &[&game_title_id],
        )
        .await?;
    let player_match_count = row.try_get::<_, i64>(0)?;
    let maximum_lengths = [
        row.try_get::<_, i32>(1)?,
        row.try_get::<_, i32>(2)?,
        row.try_get::<_, i32>(3)?,
        row.try_get::<_, i32>(4)?,
        row.try_get::<_, i32>(5)?,
    ];
    let supported_player_match_count = usize::try_from(player_match_count)
        .ok()
        .filter(|count| *count <= MAXIMUM_INPUT_ROWS);
    if supported_player_match_count.is_none()
        || !valid_input_id(game_title_id)
        || maximum_lengths.into_iter().any(|length| {
            usize::try_from(length).map_or(true, |value| value > MAXIMUM_INPUT_ID_BYTES)
        })
    {
        return Err(InputRepositoryError::InputContract(
            "input snapshot exceeds its bounded shape",
        ));
    }
    supported_player_match_count.ok_or(InputRepositoryError::InputContract(
        "input snapshot exceeds its bounded shape",
    ))
}

fn player_match_from_database(row: &Row) -> Result<PlayerMatchInput, tokio_postgres::Error> {
    Ok(PlayerMatchInput {
        match_id: row.try_get(0)?,
        match_revision: row.try_get(1)?,
        played_at: row.try_get(2)?,
        held_event_id: row.try_get(3)?,
        match_no_in_event: row.try_get(4)?,
        season_master_id: row.try_get(5)?,
        map_master_id: row.try_get(6)?,
        member_id: row.try_get(7)?,
        play_order: row.try_get(8)?,
        rank: row.try_get(9)?,
        total_assets_man_yen: row.try_get(10)?,
        revenue_man_yen: row.try_get(11)?,
        incidents: IncidentCounts {
            destination: row.try_get(12)?,
            plus_station: row.try_get(13)?,
            minus_station: row.try_get(14)?,
            card_station: row.try_get(15)?,
            card_shop: row.try_get(16)?,
            suri_no_ginji: row.try_get(17)?,
        },
    })
}

fn validate_player_matches(
    player_matches: &[PlayerMatchInput],
) -> Result<(), InputRepositoryError> {
    if player_matches.len() > MAXIMUM_INPUT_ROWS {
        return Err(InputRepositoryError::InputContract(
            "input row count exceeds the numeric safety bound",
        ));
    }
    for player_match in player_matches {
        if ![
            player_match.match_id.as_str(),
            player_match.held_event_id.as_str(),
            player_match.season_master_id.as_str(),
            player_match.map_master_id.as_str(),
            player_match.member_id.as_str(),
        ]
        .into_iter()
        .all(valid_input_id)
            || !(1..=4).contains(&player_match.rank)
            || !(1..=4).contains(&player_match.play_order)
            || player_match.match_revision < 0
            || [
                player_match.incidents.destination,
                player_match.incidents.plus_station,
                player_match.incidents.minus_station,
                player_match.incidents.card_station,
                player_match.incidents.card_shop,
                player_match.incidents.suri_no_ginji,
            ]
            .into_iter()
            .any(|count| count < 0)
        {
            return Err(InputRepositoryError::InputContract("invalid row value"));
        }
    }
    for player_matches_in_match in
        player_matches.chunk_by(|left, right| left.match_id == right.match_id)
    {
        if player_matches_in_match.len() != 4 {
            return Err(InputRepositoryError::InputContract(
                "match must contain four players",
            ));
        }
        let Some(first) = player_matches_in_match.first() else {
            return Err(InputRepositoryError::InputContract(
                "match must contain four players",
            ));
        };
        let distinct_members =
            player_matches_in_match
                .iter()
                .enumerate()
                .all(|(index, player_match)| {
                    !player_matches_in_match
                        .iter()
                        .take(index)
                        .any(|previous| previous.member_id == player_match.member_id)
                });
        let complete_ranks = (1..=4).all(|rank| {
            player_matches_in_match
                .iter()
                .any(|player_match| player_match.rank == rank)
        });
        let complete_orders = (1..=4).all(|order| {
            player_matches_in_match
                .iter()
                .any(|player_match| player_match.play_order == order)
        });
        let consistent_match = player_matches_in_match.iter().all(|player_match| {
            player_match.match_revision == first.match_revision
                && player_match.played_at == first.played_at
                && player_match.held_event_id == first.held_event_id
                && player_match.match_no_in_event == first.match_no_in_event
                && player_match.season_master_id == first.season_master_id
                && player_match.map_master_id == first.map_master_id
        });
        if !distinct_members || !complete_ranks || !complete_orders || !consistent_match {
            return Err(InputRepositoryError::InputContract(
                "match players, ranks, play orders, or metadata are inconsistent",
            ));
        }
    }
    Ok(())
}

fn valid_input_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= MAXIMUM_INPUT_ID_BYTES
        && value.bytes().enumerate().all(|(index, byte)| {
            byte.is_ascii_alphanumeric() || (index > 0 && b"._:-".contains(&byte))
        })
}

#[cfg(test)]
#[expect(
    clippy::panic,
    reason = "dependency fixtures are mandatory test inputs and report their parse failure"
)]
mod tests {
    use std::collections::BTreeMap;

    use serde::Deserialize;

    use super::*;

    const DEPENDENCIES: &str = include_str!(
        "../../../../docs/schemas/fixtures/series-analysis/input-dependencies-v1.json"
    );

    #[derive(Debug, Deserialize)]
    #[serde(deny_unknown_fields, rename_all = "camelCase")]
    struct DependencyFixture {
        schema_version: u32,
        calculation_input: Vec<RelationColumns>,
        revision_guard: Vec<RelationColumns>,
        display_hydration: Vec<RelationColumns>,
        excluded_relations: Vec<String>,
    }

    #[derive(Debug, Deserialize)]
    #[serde(deny_unknown_fields, rename_all = "camelCase")]
    struct RelationColumns {
        relation: String,
        columns: Vec<String>,
    }

    fn relation_map(entries: &[RelationColumns]) -> BTreeMap<&str, Vec<&str>> {
        entries
            .iter()
            .map(|entry| {
                (
                    entry.relation.as_str(),
                    entry.columns.iter().map(String::as_str).collect::<Vec<_>>(),
                )
            })
            .collect()
    }

    fn valid_player_matches() -> Vec<PlayerMatchInput> {
        (1..=4)
            .map(|player| PlayerMatchInput {
                match_id: String::from("match-1"),
                match_revision: 1,
                played_at: String::from("2026-08-10T00:00:00.000000Z"),
                held_event_id: String::from("event-1"),
                match_no_in_event: 1,
                season_master_id: String::from("season-1"),
                map_master_id: String::from("map-1"),
                member_id: format!("member-{player}"),
                play_order: player,
                rank: player,
                total_assets_man_yen: 1_000,
                revenue_man_yen: 100,
                incidents: IncidentCounts::default(),
            })
            .collect()
    }

    #[test]
    fn input_validation_rejects_duplicate_players_and_inconsistent_match_metadata() {
        let valid = valid_player_matches();
        assert!(validate_player_matches(&valid).is_ok());

        let mut duplicate_player = valid.clone();
        duplicate_player
            .get_mut(3)
            .unwrap_or_else(|| panic!("fourth player row"))
            .member_id = String::from("member-1");
        assert!(matches!(
            validate_player_matches(&duplicate_player),
            Err(InputRepositoryError::InputContract(
                "match players, ranks, play orders, or metadata are inconsistent"
            ))
        ));

        let mut inconsistent_match = valid;
        inconsistent_match
            .get_mut(3)
            .unwrap_or_else(|| panic!("fourth player row"))
            .season_master_id = String::from("season-2");
        assert!(matches!(
            validate_player_matches(&inconsistent_match),
            Err(InputRepositoryError::InputContract(
                "match players, ranks, play orders, or metadata are inconsistent"
            ))
        ));
    }

    #[test]
    fn input_dependency_fixture_matches_the_worker_snapshot_query() {
        let fixture: DependencyFixture = serde_json::from_str(DEPENDENCIES)
            .unwrap_or_else(|error| panic!("invalid dependency fixture: {error}"));
        assert_eq!(fixture.schema_version, 1);

        let expected = BTreeMap::from([
            (
                "matches",
                vec![
                    "id",
                    "analysis_revision",
                    "played_at",
                    "held_event_id",
                    "match_no_in_event",
                    "game_title_id",
                    "season_master_id",
                    "map_master_id",
                ],
            ),
            (
                "match_players",
                vec![
                    "match_id",
                    "member_id",
                    "play_order",
                    "rank",
                    "total_assets_man_yen",
                    "revenue_man_yen",
                ],
            ),
            (
                "match_incidents",
                vec!["match_id", "member_id", "incident_master_id", "count"],
            ),
        ]);
        assert_eq!(relation_map(&fixture.calculation_input), expected);
        assert_eq!(
            relation_map(&fixture.revision_guard),
            BTreeMap::from([
                ("game_titles", vec!["id"]),
                (
                    "series_analysis_title_states",
                    vec!["game_title_id", "input_revision"],
                ),
            ])
        );
        assert_eq!(
            relation_map(&fixture.display_hydration),
            BTreeMap::from([
                ("game_titles", vec!["name", "display_order"]),
                ("map_masters", vec!["name", "display_order"]),
                ("members", vec!["display_name"]),
                ("season_masters", vec!["name", "display_order"]),
            ])
        );
        assert_eq!(
            fixture
                .excluded_relations
                .iter()
                .map(String::as_str)
                .collect::<Vec<_>>(),
            vec!["held_events", "member_aliases", "incident_masters"]
        );

        for excluded in &fixture.excluded_relations {
            assert!(!ANALYSIS_INPUT_QUERY.contains(&format!("JOIN {excluded}")));
        }
        for required in [
            "FROM matches m",
            "JOIN match_players mp",
            "LEFT JOIN match_incidents mi",
            "m.analysis_revision",
            "m.played_at",
            "m.held_event_id",
            "m.match_no_in_event",
            "m.game_title_id",
            "m.season_master_id",
            "m.map_master_id",
            "mp.member_id",
            "mp.play_order",
            "mp.rank",
            "mp.total_assets_man_yen",
            "mp.revenue_man_yen",
            "mi.incident_master_id",
            "mi.count",
        ] {
            assert!(
                ANALYSIS_INPUT_QUERY.contains(required),
                "snapshot query no longer references required input token {required}"
            );
        }
        assert!(!ANALYSIS_INPUT_QUERY.contains("display_name"));
        assert!(!ANALYSIS_INPUT_QUERY.contains(".name"));
        assert!(!ANALYSIS_INPUT_QUERY.contains("display_order"));
    }
}
