use super::*;
use crate::series_analysis::input_repository::{InputRepositoryError, load_in_transaction};

pub(super) async fn prepare(client: &mut Client) -> SmokeResult<Vec<(String, String)>> {
    let transaction = client.transaction().await?;
    insert_counts(&transaction).await?;
    let baseline = load_in_transaction(&transaction, TITLE_ID, 1).await?;
    let mut expected = analysis_input();
    for row in &mut expected.player_matches {
        let base = 10 * row.play_order;
        row.incidents = IncidentCounts {
            destination: base + 1,
            plus_station: base + 2,
            minus_station: base + 3,
            card_station: base + 4,
            card_shop: base + 5,
            suri_no_ginji: base + 6,
        };
    }
    assert_eq!(
        baseline.player_matches(),
        expected.try_into_normalized()?.player_matches()
    );
    transaction
        .execute(
            r"
                DELETE FROM match_incidents
                WHERE (SELECT fixture_parent.legacy_id
                       FROM matches AS fixture_parent
                       WHERE fixture_parent.id = match_incidents.match_id) = $1
                ",
            &[&MATCH_ID],
        )
        .await?;
    let rows = transaction
        .query(
            r"
            SELECT incident_masters.legacy_id AS id, key
            FROM incident_masters
            ORDER BY key
            ",
            &[],
        )
        .await?;
    let mut catalog = Vec::new();
    for (index, row) in rows.iter().enumerate() {
        let original_id: String = row.try_get(0)?;
        let key: String = row.try_get(1)?;
        let uuid = format!("00000000-0000-4000-8000-{index:012x}");
        transaction
            .execute(
                r"
                    UPDATE incident_masters
                    SET id = pg_temp.fixture_uuid('incident_masters', $2), legacy_id = $2
                    WHERE key = $1
                    ",
                &[&key, &uuid],
            )
            .await?;
        catalog.push((original_id, uuid));
    }
    insert_counts(&transaction).await?;
    assert_eq!(
        load_in_transaction(&transaction, TITLE_ID, 1).await?,
        baseline,
        "storage identities cannot change calculation input"
    );
    transaction
        .batch_execute("UPDATE incident_masters SET key='unknown' WHERE key='destination'")
        .await?;
    assert!(matches!(
        load_in_transaction(&transaction, TITLE_ID, 1).await,
        Err(InputRepositoryError::InputContract(_))
    ));
    transaction
        .batch_execute("UPDATE incident_masters SET key='destination' WHERE key='unknown'")
        .await?;
    transaction.commit().await?;
    Ok(catalog)
}

async fn insert_counts(transaction: &Transaction<'_>) -> SmokeResult {
    transaction
        .execute(
            r"
                INSERT INTO match_incidents (match_id, member_id, incident_master_id, count)
                SELECT mp.match_id, mp.member_id, pg_temp.fixture_uuid('incident_masters', im.legacy_id),
                       10 * mp.play_order + expected.ordinal
                FROM match_players AS mp
                     CROSS JOIN ((VALUES ('destination', 1), ('plus_station', 2), ('minus_station', 3), ('card_station', 4),
                                         ('card_shop', 5), ('suri_no_ginji', 6))) AS expected (key, ordinal)
                     INNER JOIN incident_masters AS im ON im.key = expected.key
                WHERE (SELECT fixture_parent.legacy_id
                       FROM matches AS fixture_parent
                       WHERE fixture_parent.id = mp.match_id) = $1
                ",
            &[&MATCH_ID],
        )
        .await?;
    Ok(())
}

pub(super) async fn restore(client: &Client, catalog: &[(String, String)]) -> SmokeResult {
    for (original_id, uuid) in catalog {
        client
            .execute(
                r"
                    UPDATE incident_masters
                    SET id = pg_temp.fixture_uuid('incident_masters', $2), legacy_id = $2
                    WHERE incident_masters.legacy_id = $1
                    ",
                &[uuid, original_id],
            )
            .await?;
    }
    Ok(())
}
