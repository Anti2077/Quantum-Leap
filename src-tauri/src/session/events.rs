use crate::{
    i18n::localize,
    model::{
        PromptKind, SpeedPhase, SpeedPromptEvent, SpeedStateEvent, UiLanguage, SPEED_PROMPT_EVENT,
        SPEED_STATE_EVENT,
    },
};
use tauri::{AppHandle, Emitter};

pub(super) fn emit_state(
    app: &AppHandle,
    language: UiLanguage,
    phase: SpeedPhase,
    message: impl Into<String>,
) {
    let _ = app.emit(
        SPEED_STATE_EVENT,
        SpeedStateEvent {
            phase,
            message: localize(language, message.into()),
        },
    );
}

pub(super) fn emit_prompt(
    app: &AppHandle,
    language: UiLanguage,
    kind: PromptKind,
    title: impl Into<String>,
    message: impl Into<String>,
    detail: Option<String>,
) {
    emit_state(app, language, SpeedPhase::Confirming, "等待确认后继续");
    let _ = app.emit(
        SPEED_PROMPT_EVENT,
        SpeedPromptEvent {
            kind,
            title: localize(language, title.into()),
            message: localize(language, message.into()),
            detail,
        },
    );
}
