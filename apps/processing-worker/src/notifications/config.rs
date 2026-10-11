use std::{fmt, time::Duration};

use reqwest::{Client, header::HeaderValue};
use thiserror::Error;
use url::{Host, Url};

pub(super) const MAXIMUM_PENDING: usize = 16;
pub(super) const MAXIMUM_ANALYSIS_JSONB_BYTES: usize = 256 * 1024;
pub(super) const MAXIMUM_OCR_JSONB_BYTES: usize = 16 * 1024;
pub(super) const MAXIMUM_BYTES: usize = MAXIMUM_PENDING * MAXIMUM_ANALYSIS_JSONB_BYTES;
pub(super) const MAXIMUM_WIRE_BYTES: usize = 512 * 1024;
pub(super) const CONCURRENT_REQUESTS: usize = 2;
pub(super) const REQUEST_TIMEOUT: Duration = Duration::from_secs(5);

/// Transport activation is separate from the user's durable ON/OFF setting.
pub(crate) struct NotificationConfig(Option<HttpConfig>);

pub(super) struct HttpConfig {
    pub(super) endpoint: Url,
    pub(super) authorization: HeaderValue,
}

impl fmt::Debug for NotificationConfig {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("NotificationConfig([REDACTED])")
    }
}

impl NotificationConfig {
    pub(crate) const fn disabled() -> Self {
        Self(None)
    }

    pub(super) fn into_http(self) -> Option<HttpConfig> {
        self.0
    }

    pub(crate) fn http(endpoint: &str, token: &str) -> Result<Self, NotificationConfigError> {
        let endpoint = Url::parse(endpoint).map_err(|_error| NotificationConfigError)?;
        let internal = match endpoint.host() {
            Some(Host::Domain(host)) => host.ends_with(".internal") || host == "localhost",
            Some(Host::Ipv4(address)) => address.is_private() || address.is_loopback(),
            Some(Host::Ipv6(address)) => address.is_unique_local() || address.is_loopback(),
            None => false,
        };
        if !internal
            || !matches!(endpoint.scheme(), "http" | "https")
            || !endpoint.username().is_empty()
            || endpoint.password().is_some()
            || endpoint.query().is_some()
            || endpoint.fragment().is_some()
            || endpoint.path() != "/internal/discord-notifications"
            || token.len() < 32
            || token.len() > 4096
            || !token.bytes().all(|byte| byte.is_ascii_graphic())
        {
            return Err(NotificationConfigError);
        }
        let mut authorization = HeaderValue::from_str(&format!("Bearer {token}"))
            .map_err(|_error| NotificationConfigError)?;
        authorization.set_sensitive(true);
        Ok(Self(Some(HttpConfig {
            endpoint,
            authorization,
        })))
    }
}

pub(super) fn client() -> Result<Client, NotificationConfigError> {
    Client::builder()
        .retry(reqwest::retry::never())
        .redirect(reqwest::redirect::Policy::none())
        .no_proxy()
        .http1_only()
        .pool_max_idle_per_host(CONCURRENT_REQUESTS)
        .timeout(REQUEST_TIMEOUT)
        .build()
        .map_err(|_error| NotificationConfigError)
}

#[derive(Debug, Error)]
#[error("result notification transport configuration is invalid")]
pub(crate) struct NotificationConfigError;

#[cfg(test)]
#[cfg(target_os = "linux")]
mod tests;
