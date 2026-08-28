use futures_util::TryStreamExt;
use momo_analysis_core::model::{
    AnalysisInput, IncidentCounts, MAXIMUM_INPUT_ID_BYTES, MAXIMUM_PLAYER_MATCH_ROWS,
    NormalizedAnalysisInput, PlayerMatchInput,
};
use thiserror::Error;
use tokio_postgres::{Client, IsolationLevel, Row};

// The query asks for one sentinel row beyond the capability-owned bound. The database adapter
// therefore prevents an oversized snapshot from being materialized before domain validation.
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

    let query_limit = i64::try_from(MAXIMUM_PLAYER_MATCH_ROWS)
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
    .try_into_normalized()
    .map_err(|error| InputRepositoryError::InputContract(error.reason()))?;
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
        .filter(|count| *count <= MAXIMUM_PLAYER_MATCH_ROWS);
    if supported_player_match_count.is_none()
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
