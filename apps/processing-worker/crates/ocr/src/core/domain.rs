use serde::Serialize;
use serde_json::Value as JsonValue;

#[derive(Clone, Debug, Serialize)]
pub(crate) struct OcrWarning {
    code: String,
    message: String,
    severity: &'static str,
    field_path: Option<String>,
}

impl OcrWarning {
    pub(crate) fn warning(
        code: &'static str,
        message: impl Into<String>,
        field_path: Option<String>,
    ) -> Self {
        Self {
            code: String::from(code),
            message: message.into(),
            severity: "warning",
            field_path,
        }
    }

    pub(crate) fn code(&self) -> &str {
        &self.code
    }

    pub(crate) fn field_path(&self) -> Option<&str> {
        self.field_path.as_deref()
    }
}

#[derive(Clone, Debug, Serialize)]
pub(crate) struct OcrField<T> {
    pub(crate) value: Option<T>,
    pub(crate) raw_text: Option<String>,
    pub(crate) confidence: Option<f64>,
    pub(crate) warnings: Vec<OcrWarning>,
}

impl<T> OcrField<T> {
    pub(crate) const fn empty() -> Self {
        Self {
            value: None,
            raw_text: None,
            confidence: None,
            warnings: Vec::new(),
        }
    }

    pub(crate) fn recognized(
        value: T,
        raw_text: impl Into<String>,
        confidence: Option<f64>,
    ) -> Self {
        Self {
            value: Some(value),
            raw_text: Some(raw_text.into()),
            confidence,
            warnings: Vec::new(),
        }
    }

    pub(crate) fn observed(
        value: Option<T>,
        raw_text: impl Into<String>,
        confidence: Option<f64>,
    ) -> Self {
        Self {
            value,
            raw_text: Some(raw_text.into()),
            confidence,
            warnings: Vec::new(),
        }
    }
}

#[derive(Clone, Debug, Serialize)]
pub(crate) struct PlayerDraft {
    pub(crate) raw_player_name: OcrField<String>,
    pub(crate) member_id: Option<String>,
    pub(crate) play_order: OcrField<u8>,
    pub(crate) rank: OcrField<u8>,
    pub(crate) total_assets_man_yen: OcrField<i64>,
    pub(crate) revenue_man_yen: OcrField<i64>,
    pub(crate) incidents: std::collections::BTreeMap<String, OcrField<u32>>,
}

impl PlayerDraft {
    pub(crate) const fn empty() -> Self {
        Self {
            raw_player_name: OcrField::empty(),
            member_id: None,
            play_order: OcrField::empty(),
            rank: OcrField::empty(),
            total_assets_man_yen: OcrField::empty(),
            revenue_man_yen: OcrField::empty(),
            incidents: std::collections::BTreeMap::new(),
        }
    }
}

#[derive(Debug, Serialize)]
pub(crate) struct DraftPayload {
    pub(crate) requested_screen_type: String,
    pub(crate) detected_screen_type: Option<String>,
    pub(crate) profile_id: Option<String>,
    pub(crate) players: Vec<PlayerDraft>,
    pub(crate) category_payload: JsonValue,
    pub(crate) warnings: Vec<OcrWarning>,
    pub(crate) raw_snippets: Option<std::collections::BTreeMap<String, String>>,
}
