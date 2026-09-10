use std::{env, fmt, time::Duration};

use reqwest::{Client, header::HeaderValue};
use thiserror::Error;
use url::{Host, Url};

pub(super) const MAXIMUM_PENDING: usize = 16;
pub(super) const MAXIMUM_BYTES: usize = 32 * 1024 * 1024;
pub(super) const MAXIMUM_WIRE_BYTES: usize = 16 * 1024 * 1024;
pub(super) const CONCURRENT_REQUESTS: usize = 2;
pub(super) const REQUEST_TIMEOUT: Duration = Duration::from_secs(5);
pub(super) const CONNECT_TIMEOUT: Duration = Duration::from_secs(1);

/// Transport activation is separate from the user's durable ON/OFF setting.
pub(crate) enum NotificationConfig {
    Disabled,
    Http(HttpConfig),
}

pub(crate) struct HttpConfig {
    pub(super) endpoint: Url,
    pub(super) authorization: HeaderValue,
}

impl fmt::Debug for NotificationConfig {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("NotificationConfig([REDACTED])")
    }
}

impl NotificationConfig {
    pub(crate) fn from_environment() -> Result<Self, NotificationConfigError> {
        let mode = env::var("RESULT_NOTIFICATIONS_MODE");
        match mode.as_deref() {
            Ok("disabled") | Err(env::VarError::NotPresent) => Ok(Self::Disabled),
            Ok("http") => Self::http(
                &env::var("RESULT_NOTIFICATIONS_URL").map_err(|_error| NotificationConfigError)?,
                &env::var("RESULT_NOTIFICATIONS_BEARER_TOKEN")
                    .map_err(|_error| NotificationConfigError)?,
            ),
            Ok(_) | Err(env::VarError::NotUnicode(_)) => Err(NotificationConfigError),
        }
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
        Ok(Self::Http(HttpConfig {
            endpoint,
            authorization,
        }))
    }
}

pub(super) fn client() -> Result<Client, NotificationConfigError> {
    Client::builder()
        .retry(reqwest::retry::never())
        .redirect(reqwest::redirect::Policy::none())
        .no_proxy()
        .http1_only()
        .pool_max_idle_per_host(CONCURRENT_REQUESTS)
        .connect_timeout(CONNECT_TIMEOUT)
        .timeout(REQUEST_TIMEOUT)
        .build()
        .map_err(|_error| NotificationConfigError)
}

#[derive(Debug, Error)]
#[error("result notification transport configuration is invalid")]
pub(crate) struct NotificationConfigError;
