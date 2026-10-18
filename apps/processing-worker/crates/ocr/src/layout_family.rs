/// Code-owned layout selection, distinct from an absent hint's automatic selection.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum LayoutFamily {
    Momotetsu2,
    World,
    Reiwa,
}

impl LayoutFamily {
    pub(crate) fn from_legacy(value: &str) -> Option<Self> {
        match value
            .trim_matches([' ', '\t', '\r', '\n', '\x0b', '\x0c'])
            .to_ascii_lowercase()
            .as_str()
        {
            "momotetsu_2" | "momotetsu2" | "2" => Some(Self::Momotetsu2),
            "world" | "momotetsu_world" | "default" => Some(Self::World),
            "reiwa" | "momotetsu_reiwa" => Some(Self::Reiwa),
            _ => None,
        }
    }
}

#[cfg(test)]
#[expect(
    clippy::panic_in_result_fn,
    reason = "shared fixture setup uses Result while assertions check contract values"
)]
mod tests {
    use super::LayoutFamily;

    #[test]
    fn shared_legacy_layout_contract() -> Result<(), Box<dyn std::error::Error>> {
        let fixture: serde_json::Value = serde_json::from_str(include_str!(
            "../../../../../docs/schemas/fixtures/ocr-worker/layout-families-v1.json"
        ))?;
        for entry in fixture
            .get("accepted")
            .and_then(serde_json::Value::as_array)
            .ok_or("accepted cases")?
        {
            let input = entry
                .get("input")
                .and_then(serde_json::Value::as_str)
                .ok_or("input spelling")?;
            let expected = match entry
                .get("canonical")
                .and_then(serde_json::Value::as_str)
                .ok_or("canonical layout")?
            {
                "momotetsu_2" => LayoutFamily::Momotetsu2,
                "world" => LayoutFamily::World,
                "reiwa" => LayoutFamily::Reiwa,
                _ => return Err("fixture contains a noncanonical layout".into()),
            };
            assert_eq!(
                LayoutFamily::from_legacy(input),
                Some(expected),
                "{input:?}"
            );
        }
        for entry in fixture
            .get("rejected")
            .and_then(serde_json::Value::as_array)
            .ok_or("rejected cases")?
        {
            let input = entry.as_str().ok_or("rejected spelling")?;
            assert_eq!(LayoutFamily::from_legacy(input), None, "{input:?}");
        }
        Ok(())
    }
}
