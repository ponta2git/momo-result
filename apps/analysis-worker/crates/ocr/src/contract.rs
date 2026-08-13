const MAXIMUM_HINT_TEXT_CHARACTERS: usize = 64;
const MAXIMUM_KNOWN_PLAYERS: usize = 4;
const MAXIMUM_MEMBER_ID_CHARACTERS: usize = 128;
const MAXIMUM_ALIASES_PER_PLAYER: usize = 8;
const MAXIMUM_COMPUTER_ALIASES: usize = 8;

/// Media types accepted by the OCR object-store adapter.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum OcrMediaType {
    Png,
    Jpeg,
    Webp,
}

impl OcrMediaType {
    #[must_use]
    pub fn parse_wire(value: &str) -> Option<Self> {
        match value {
            "image/png" => Some(Self::Png),
            "image/jpeg" => Some(Self::Jpeg),
            "image/webp" => Some(Self::Webp),
            _ => None,
        }
    }

    #[must_use]
    pub const fn wire(self) -> &'static str {
        match self {
            Self::Png => "image/png",
            Self::Jpeg => "image/jpeg",
            Self::Webp => "image/webp",
        }
    }
}

/// Closed set of OCR screen-specific parsers.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum RequestedScreenType {
    TotalAssets,
    Revenue,
    IncidentLog,
}

impl RequestedScreenType {
    #[must_use]
    pub fn parse_wire(value: &str) -> Option<Self> {
        match value {
            "total_assets" => Some(Self::TotalAssets),
            "revenue" => Some(Self::Revenue),
            "incident_log" => Some(Self::IncidentLog),
            _ => None,
        }
    }

    #[must_use]
    pub const fn wire(self) -> &'static str {
        match self {
            Self::TotalAssets => "total_assets",
            Self::Revenue => "revenue",
            Self::IncidentLog => "incident_log",
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, serde::Deserialize, serde::Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct PlayerAliasHint {
    member_id: String,
    aliases: Vec<String>,
}

impl PlayerAliasHint {
    #[must_use]
    pub fn member_id(&self) -> &str {
        &self.member_id
    }

    #[must_use]
    pub fn aliases(&self) -> &[String] {
        &self.aliases
    }
}

#[derive(Clone, Debug, Default, Eq, PartialEq, serde::Deserialize, serde::Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct OcrHints {
    game_title: Option<String>,
    layout_family: Option<String>,
    #[serde(default)]
    known_player_aliases: Vec<PlayerAliasHint>,
    #[serde(default)]
    computer_player_aliases: Vec<String>,
}

impl OcrHints {
    #[must_use]
    pub fn game_title(&self) -> Option<&str> {
        self.game_title.as_deref()
    }

    #[must_use]
    pub fn layout_family(&self) -> Option<&str> {
        self.layout_family.as_deref()
    }

    #[must_use]
    pub fn known_player_aliases(&self) -> &[PlayerAliasHint] {
        &self.known_player_aliases
    }

    #[must_use]
    pub fn computer_player_aliases(&self) -> &[String] {
        &self.computer_player_aliases
    }

    /// Validates bounded hint values after transport decoding.
    #[must_use]
    pub fn is_valid(&self) -> bool {
        self.game_title.as_deref().is_none_or(valid_hint_text)
            && self.layout_family.as_deref().is_none_or(valid_hint_text)
            && self.known_player_aliases.len() <= MAXIMUM_KNOWN_PLAYERS
            && self.known_player_aliases.iter().all(|hint| {
                valid_bounded_text(&hint.member_id, MAXIMUM_MEMBER_ID_CHARACTERS)
                    && !hint.aliases.is_empty()
                    && hint.aliases.len() <= MAXIMUM_ALIASES_PER_PLAYER
                    && hint.aliases.iter().all(|alias| valid_hint_text(alias))
            })
            && self.computer_player_aliases.len() <= MAXIMUM_COMPUTER_ALIASES
            && self
                .computer_player_aliases
                .iter()
                .all(|alias| valid_hint_text(alias))
    }
}

/// Queue data after the Redis transport has been decoded and validated.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct OcrQueuePayload {
    job_id: String,
    draft_id: String,
    source_image_id: String,
    image_object_key: String,
    sha256: String,
    byte_length: u64,
    media_type: OcrMediaType,
    requested_screen_type: RequestedScreenType,
    attempt: u32,
    hints: OcrHints,
    request_id: Option<String>,
}

impl OcrQueuePayload {
    #[must_use]
    #[expect(
        clippy::too_many_arguments,
        reason = "the transport adapter constructs every field of the closed OCR queue contract"
    )]
    pub const fn new(
        job_id: String,
        draft_id: String,
        source_image_id: String,
        image_object_key: String,
        sha256: String,
        byte_length: u64,
        media_type: OcrMediaType,
        requested_screen_type: RequestedScreenType,
        attempt: u32,
        hints: OcrHints,
        request_id: Option<String>,
    ) -> Self {
        Self {
            job_id,
            draft_id,
            source_image_id,
            image_object_key,
            sha256,
            byte_length,
            media_type,
            requested_screen_type,
            attempt,
            hints,
            request_id,
        }
    }

    #[must_use]
    pub fn job_id(&self) -> &str {
        &self.job_id
    }

    #[must_use]
    pub fn draft_id(&self) -> &str {
        &self.draft_id
    }

    #[must_use]
    pub fn source_image_id(&self) -> &str {
        &self.source_image_id
    }

    #[must_use]
    pub fn image_object_key(&self) -> &str {
        &self.image_object_key
    }

    #[must_use]
    pub fn sha256(&self) -> &str {
        &self.sha256
    }

    #[must_use]
    pub const fn byte_length(&self) -> u64 {
        self.byte_length
    }

    #[must_use]
    pub const fn media_type(&self) -> OcrMediaType {
        self.media_type
    }

    #[must_use]
    pub const fn requested_screen_type(&self) -> RequestedScreenType {
        self.requested_screen_type
    }

    #[must_use]
    pub const fn attempt(&self) -> u32 {
        self.attempt
    }

    #[must_use]
    pub const fn hints(&self) -> &OcrHints {
        &self.hints
    }

    #[must_use]
    pub fn request_id(&self) -> Option<&str> {
        self.request_id.as_deref()
    }
}

fn valid_hint_text(value: &str) -> bool {
    valid_bounded_text(value, MAXIMUM_HINT_TEXT_CHARACTERS)
}

fn valid_bounded_text(value: &str, maximum_characters: usize) -> bool {
    !value.is_empty() && value.chars().count() <= maximum_characters
}
