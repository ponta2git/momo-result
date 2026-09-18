//! Semantic checks for the owner matrix; the schema owns its bounded shape.
use serde_json::Value;

use super::{PayloadError, array, required_string, required_u64};
use crate::{numeric::exact_i64_as_f64, stats::quality_status};

fn field<'a>(value: &'a Value, path: &str) -> Result<&'a Value, PayloadError> {
    value.pointer(path).ok_or(PayloadError::InvalidSchema)
}

fn ratio(numerator: u64, denominator: u64) -> Result<Option<f64>, PayloadError> {
    if denominator == 0 {
        return Ok(None);
    }
    let numerator =
        exact_i64_as_f64(i64::try_from(numerator)?).ok_or(PayloadError::InvalidSchema)?;
    let denominator =
        exact_i64_as_f64(i64::try_from(denominator)?).ok_or(PayloadError::InvalidSchema)?;
    Ok(Some(numerator / denominator))
}

fn check_ratio(value: &Value, numerator: u64, denominator: u64) -> Result<(), PayloadError> {
    let expected = ratio(numerator, denominator)?;
    if value.as_f64() != expected || (expected.is_none() && !value.is_null()) {
        return Err(PayloadError::InvalidSchema);
    }
    Ok(())
}

pub(super) fn validate(
    value: &Value,
    players: &[&str],
    match_count: u64,
) -> Result<(), PayloadError> {
    let owners = array(value.get("owners"))?;
    let rows = array(value.get("rows"))?;
    if owners.len() != players.len()
        || rows.len() != players.len()
        || (match_count == 0 && !players.is_empty())
        || (match_count > 0 && players.len() != 4)
    {
        return Err(PayloadError::ReferenceMismatch);
    }
    let mut total = 0_u64;
    let mut recorded = 0_u64;
    for (index, owner) in owners.iter().enumerate() {
        if required_string(owner.get("memberId"))?
            != *players.get(index).ok_or(PayloadError::ReferenceMismatch)?
        {
            return Err(PayloadError::ReferenceMismatch);
        }
        let count = required_u64(owner.get("targetCount"))?;
        total = total
            .checked_add(count)
            .ok_or(PayloadError::InvalidSchema)?;
        recorded += u64::from(count > 0);
        if required_string(owner.get("qualityStatus"))? != quality_status(usize::try_from(count)?) {
            return Err(PayloadError::InvalidSchema);
        }
        let mut rank_totals = [0_u64; 4];
        for (row, member) in rows.iter().zip(players) {
            if required_string(row.get("memberId"))? != *member {
                return Err(PayloadError::ReferenceMismatch);
            }
            let cells = array(row.get("cells"))?;
            if cells.len() != owners.len() {
                return Err(PayloadError::ReferenceMismatch);
            }
            let cell = cells.get(index).ok_or(PayloadError::ReferenceMismatch)?;
            if required_string(cell.get("ownerMemberId"))?
                != required_string(owner.get("memberId"))?
            {
                return Err(PayloadError::ReferenceMismatch);
            }
            validate_cell(cell, count, &mut rank_totals)?;
        }
        if rank_totals.iter().any(|rank_total| *rank_total != count) {
            return Err(PayloadError::InvalidSchema);
        }
    }
    if total != match_count || required_u64(value.get("recordedOwnerCount"))? != recorded {
        return Err(PayloadError::InvalidSchema);
    }
    Ok(())
}

fn validate_cell(cell: &Value, count: u64, rank_totals: &mut [u64; 4]) -> Result<(), PayloadError> {
    let ranks = array(field(cell, "/rank")?.get("distribution"))?;
    if ranks.len() != 4 {
        return Err(PayloadError::InvalidSchema);
    }
    let mut rank_count = 0_u64;
    let mut rank_sum = 0_u64;
    for (index, entry) in ranks.iter().enumerate() {
        let rank = u64::try_from(index + 1)?;
        let n = required_u64(entry.get("count"))?;
        if required_u64(entry.get("rank"))? != rank {
            return Err(PayloadError::InvalidSchema);
        }
        rank_count = rank_count
            .checked_add(n)
            .ok_or(PayloadError::InvalidSchema)?;
        rank_sum = rank_sum
            .checked_add(n.checked_mul(rank).ok_or(PayloadError::InvalidSchema)?)
            .ok_or(PayloadError::InvalidSchema)?;
        let total = rank_totals
            .get_mut(index)
            .ok_or(PayloadError::InvalidSchema)?;
        *total = total.checked_add(n).ok_or(PayloadError::InvalidSchema)?;
        check_ratio(field(entry, "/rate")?, n, count)?;
    }
    if rank_count != count {
        return Err(PayloadError::InvalidSchema);
    }
    check_ratio(field(cell, "/rank/average")?, rank_sum, count)?;
    for metric in ["assets", "revenue"] {
        let value = field(cell, &format!("/{metric}/average"))?;
        if (count == 0 && !value.is_null()) || (count > 0 && value.as_f64().is_none()) {
            return Err(PayloadError::InvalidSchema);
        }
    }
    for metric in ["destination", "ginji"] {
        let n = required_u64(field(cell, &format!("/{metric}"))?.get("count"))?;
        if count == 0 && n != 0 {
            return Err(PayloadError::InvalidSchema);
        }
        check_ratio(field(cell, &format!("/{metric}/average"))?, n, count)?;
    }
    let ginji = field(cell, "/ginji")?;
    let n = required_u64(ginji.get("count"))?;
    let encounters = required_u64(ginji.get("encounterMatches"))?;
    if encounters > count || encounters > n || (n == 0) != (encounters == 0) {
        return Err(PayloadError::InvalidSchema);
    }
    check_ratio(field(ginji, "/encounterRate")?, encounters, count)
}
