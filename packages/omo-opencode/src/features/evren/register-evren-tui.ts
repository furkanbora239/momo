import type { TuiPluginApi } from "@opencode-ai/plugin/tui"

import { log } from "../../shared/logger"
import type { SolidRuntime } from "../tui-card"
import { readEvrenConsentStatus, writeEvrenConsent } from "./consent"
import { ensureEvrenTermsAccepted } from "./ensure-terms"
import { EVREN_TERMS_VERSION } from "./terms"

export function buildEvrenConsentMessage(): string {
  return [
    "EVREN, SSB EVREN LLM Gateway hizmetidir (OpenAI uyumlu).",
    "Bu sağlayıcıyı kullanmak, istemlerinizi (prompt) ve kod bağlamınızı EVREN gateway'ine gönderir.",
    "Kullanım için kullanım şartlarının v1 sürümünü kabul etmeniz gerekir.",
    "Şartlar zaman içinde değişebilir; güncellemeleri https://evren.ssyz.org.tr adresinden takip edin.",
  ].join(" ")
}

export async function registerEvrenTui<Node>(
  api: TuiPluginApi,
  _solid: SolidRuntime<Node>,
): Promise<void> {
  log("[evren] TUI registration started")

  const accept = (): void => {
    try {
      writeEvrenConsent({
        version: 1,
        status: "accepted",
        termsVersion: EVREN_TERMS_VERSION,
        updatedAt: new Date().toISOString(),
      })
      void ensureEvrenTermsAccepted()
      api.ui.toast({
        variant: "success",
        message: "EVREN LLM etkinleştirildi. Kullanım şartlarını https://evren.ssyz.org.tr adresinden takip edin.",
      })
    } catch (error) {
      log("[evren] Failed to record consent acceptance", { error: String(error) })
    }
  }

  const decline = (): void => {
    try {
      writeEvrenConsent({
        version: 1,
        status: "declined",
        termsVersion: 0,
        updatedAt: new Date().toISOString(),
      })
      api.ui.toast({
        variant: "info",
        message: "EVREN LLM kurulumu reddedildi. Etkinleştirmek için /evren komutunu kullanın.",
      })
    } catch (error) {
      log("[evren] Failed to record consent decline", { error: String(error) })
    }
  }

  const openConsentDialog = (): void => {
    try {
      api.ui.dialog.replace(() =>
        api.ui.DialogConfirm({
          title: "EVREN LLM - Kullanım Şartları",
          message: buildEvrenConsentMessage(),
          onConfirm: accept,
          onCancel: decline,
        }),
      )
    } catch (error) {
      log("[evren] Failed to open consent dialog", { error: String(error) })
    }
  }

  try {
    const unregisterSlashCommand =
      api.command?.register(() => [
        {
          title: "EVREN LLM",
          value: "omo.evren.slash",
          description: "EVREN LLM kullanım şartları onay kutusunu açar",
          category: "Session",
          enabled: true,
          slash: {
            name: "evren",
          },
          onSelect: () => openConsentDialog(),
        },
      ]) ?? (() => undefined)

    api.lifecycle.onDispose(() => {
      unregisterSlashCommand()
    })

    if (readEvrenConsentStatus() === "unknown") {
      setTimeout(() => {
        if (readEvrenConsentStatus() === "unknown") {
          openConsentDialog()
        }
      }, 0)
    }

    log("[evren] TUI controls registered")
  } catch (error) {
    log("[evren] TUI registration failed", { error: String(error) })
  }
}
