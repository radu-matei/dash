use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt, Layer};

/// Initializes tracing with two output layers split by severity.
/// Uses a fixed log level since this component is injected without
/// variable declarations in the manifest.
pub fn setup_tracing() {
    let env_filter = tracing_subscriber::EnvFilter::new("error");

    let error_layer = tracing_subscriber::fmt::layer()
        .with_writer(std::io::stderr)
        .with_ansi(false)
        .with_filter(tracing_subscriber::filter::LevelFilter::ERROR);

    let other_layer = tracing_subscriber::fmt::layer()
        .with_writer(std::io::stdout)
        .with_ansi(false)
        .with_filter(tracing_subscriber::filter::filter_fn(|metadata| {
            metadata.level() > &tracing::Level::ERROR
        }));

    tracing_subscriber::registry()
        .with(env_filter)
        .with(error_layer)
        .with(other_layer)
        .init();
}
