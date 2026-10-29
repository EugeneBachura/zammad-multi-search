const extensionApi = globalThis.browser || globalThis.chrome;
function sitePattern(origin) {
  const address = new URL(origin);
  return `${address.protocol}//${address.hostname}/*`;
}
const translations = {
  en: {
    privateDisclosure: "Private window: queries, tab names and tab order are kept only in memory, separately from regular windows. They are removed when the last private window closes. Queries may contain personal information. Nothing is sent to the developer.",
    privateDisabled: "Search tabs are disabled for this private site. Enable it for this private session.",
    sharedDisclosure: "Private window with shared saved searches: queries, tab names and tab order are saved in your regular browser profile for the same Zammad address and account. They remain after private windows close. Nothing is sent to the developer.",
    disclosure: "Save search text locally in this browser profile, grouped by the Zammad address and account ID. Queries may contain personal information. Nothing is sent to the developer.",
    enable: "Enable on this site", allow: "Allow access and enable", disable: "Disable on this site", settings: "Settings", privacy: "Privacy policy",
    checking: "Checking this page…", working: "Please wait…", signInButton: "Sign in to Zammad first", openButton: "Open Zammad", loadingButton: "Zammad is loading…",
    disabled: "Search tabs are disabled on this site. Saved queries are kept until you remove them in Settings.", accessWarning: "The integration is disabled. The browser could not remove site access; you can remove it in your browser's extension settings.",
    allowHelp: "Your browser will ask for permission to read and change this site. After you allow access, search tabs will turn on automatically.",
    allowCheckHelp: "Allow access so the extension can check this page for Zammad and enable search tabs. Your browser will ask for permission to read and change this site.",
    signIn: "Sign in to Zammad on this page. The extension needs a workspace with ticket search.",
    loading: "Wait for the Zammad workspace to finish loading. This panel will update automatically.",
    unsupported: "No supported Zammad workspace was found on this page. Open Zammad and sign in.",
    unknown: "Could not check this page. Reload Zammad, then open this panel again.",
    unavailable: "Open a Zammad website and sign in to its desktop interface.",
    enabledSignIn: "Enabled for this site. Sign in to Zammad to use your search tabs.",
    denied: "Site access was not granted. Click Allow access and enable to try again.", success: "Search tabs are ready. You can close this panel.", error: "Could not enable search tabs. Reload Zammad and try again."
  },
  pl: {
    privateDisclosure: "Okno prywatne: zapytania, nazwy zakładek i ich kolejność są przechowywane tylko w pamięci, oddzielnie od zwykłych okien. Znikają po zamknięciu ostatniego okna prywatnego. Zapytania mogą zawierać dane osobowe. Nic nie jest wysyłane do autora.",
    privateDisabled: "Zakładki są wyłączone w tej prywatnej witrynie. Włącz je na czas tej sesji prywatnej.",
    sharedDisclosure: "Okno prywatne ze wspólnymi wyszukiwaniami: zapytania, nazwy zakładek i ich kolejność są zapisywane w zwykłym profilu przeglądarki dla tego samego adresu i konta Zammad. Pozostają po zamknięciu okien prywatnych. Nic nie jest wysyłane do autora.",
    disclosure: "Zapisuj tekst zapytań lokalnie w tym profilu przeglądarki, osobno dla adresu Zammad i identyfikatora konta. Zapytania mogą zawierać dane osobowe. Nic nie jest wysyłane do autora.",
    enable: "Włącz w tej witrynie", allow: "Zezwól na dostęp i włącz", disable: "Wyłącz w tej witrynie", settings: "Ustawienia", privacy: "Polityka prywatności",
    checking: "Sprawdzanie strony…", working: "Proszę czekać…", signInButton: "Najpierw zaloguj się do Zammad", openButton: "Otwórz Zammad", loadingButton: "Zammad się ładuje…",
    disabled: "Zakładki wyszukiwania są wyłączone w tej witrynie. Zapisane zapytania można usunąć w ustawieniach.", accessWarning: "Integracja jest wyłączona. Przeglądarka nie usunęła dostępu do witryny; można go usunąć w ustawieniach rozszerzenia w przeglądarce.",
    allowHelp: "Przeglądarka poprosi o zgodę na odczytywanie i zmienianie tej witryny. Po udzieleniu dostępu zakładki włączą się automatycznie.",
    allowCheckHelp: "Zezwól na dostęp, aby rozszerzenie mogło sprawdzić, czy to Zammad, i włączyć zakładki. Przeglądarka poprosi o zgodę na odczytywanie i zmienianie tej witryny.",
    signIn: "Zaloguj się do Zammad na tej stronie. Rozszerzenie wymaga interfejsu z wyszukiwaniem zgłoszeń.",
    loading: "Poczekaj, aż załaduje się interfejs Zammad. Ten panel zaktualizuje się automatycznie.",
    unsupported: "Na tej stronie nie znaleziono obsługiwanego interfejsu Zammad. Otwórz Zammad i zaloguj się.",
    unknown: "Nie udało się sprawdzić strony. Odśwież Zammad i ponownie otwórz ten panel.",
    unavailable: "Otwórz witrynę Zammad i zaloguj się do interfejsu komputerowego.",
    enabledSignIn: "Włączono dla tej witryny. Zaloguj się do Zammad, aby korzystać z zakładek wyszukiwania.",
    denied: "Nie udzielono dostępu do witryny. Kliknij Zezwól na dostęp i włącz, aby spróbować ponownie.", success: "Zakładki wyszukiwania są gotowe. Możesz zamknąć ten panel.", error: "Nie udało się włączyć zakładek. Odśwież Zammad i spróbuj ponownie."
  }
};

const messages = translations[extensionApi.i18n.getUILanguage().slice(0, 2)] || translations.en;
document.documentElement.lang = messages === translations.pl ? "pl" : "en";
document.querySelectorAll("[data-message]").forEach(element => { element.textContent = messages[element.dataset.message]; });
const button = document.querySelector("#enable");
const status = document.querySelector("#status");
let targetTab;
let origin;
let context = { enabled: false, hasAccess: false, pageState: "checking", privateMode: false, sharedSearches: false };
let busy = false;
let feedback = "";
let refreshVersion = 0;

function render() {
  document.querySelector('[data-message="disclosure"]').textContent = context.privateMode ? messages[context.sharedSearches ? "sharedDisclosure" : "privateDisclosure"] : messages.disclosure;
  let label;
  let help;
  let disabled = false;
  if (context.enabled) {
    label = messages.disable;
    help = context.pageState === "signIn" ? messages.enabledSignIn : messages[context.pageState] || messages.success;
  } else if (["signIn", "loading", "unsupported", "unavailable", "checking"].includes(context.pageState)) {
    const labels = { signIn: "signInButton", loading: "loadingButton", unsupported: "openButton", unavailable: "openButton", checking: "checking" };
    label = messages[labels[context.pageState]];
    help = messages[context.pageState] || "";
    disabled = true;
  } else {
    label = context.hasAccess ? messages.enable : messages.allow;
    help = context.hasAccess
      ? (context.pageState === "unknown" ? messages.unknown : messages[context.privateMode ? "privateDisabled" : "disabled"])
      : messages[context.pageState === "unknown" ? "allowCheckHelp" : "allowHelp"];
  }
  button.textContent = busy ? messages.working : label;
  button.disabled = busy || disabled;
  button.setAttribute("aria-busy", String(busy));
  status.textContent = feedback || help;
}

async function refresh() {
  if (busy || !origin) return;
  const version = ++refreshVersion;
  const result = await extensionApi.runtime.sendMessage({ type: "search-tabs:site-status", tabId: targetTab.id, origin });
  if (busy || version !== refreshVersion) return;
  if (!result?.ok) throw new Error(messages.error);
  if (Object.keys(context).some(key => context[key] !== result[key])) feedback = "";
  context = { enabled: result.enabled, hasAccess: result.hasAccess, pageState: result.pageState, privateMode: Boolean(result.privateMode), sharedSearches: Boolean(result.sharedSearches) };
  render();
}

async function initialize() {
  [targetTab] = await extensionApi.tabs.query({ active: true, currentWindow: true });
  if (!targetTab?.id || !/^https?:\/\//.test(targetTab.url || "")) {
    context.pageState = "unavailable";
    render();
    return;
  }
  origin = new URL(targetTab.url).origin;
  document.querySelector("#site").textContent = origin;
  await refresh();
}

button.addEventListener("click", async () => {
  busy = true;
  refreshVersion++;
  feedback = "";
  render();
  let message = "";
  try {
    let type = context.enabled ? "search-tabs:disable" : "search-tabs:enable";
    if (!context.enabled && !context.hasAccess) {
      const preparing = extensionApi.runtime.sendMessage({ type: "search-tabs:prepare-enable", tabId: targetTab.id, origin }).catch(() => ({ ok: false }));
      let granted;
      try {
        granted = await extensionApi.permissions.request({ origins: [sitePattern(origin)] });
      } catch (error) {
        await preparing;
        await extensionApi.runtime.sendMessage({ type: "search-tabs:cancel-enable", tabId: targetTab.id, origin });
        throw error;
      }
      const prepared = await preparing;
      if (!prepared?.ok) {
        message = messages[prepared?.reason] || messages.error;
        return;
      }
      if (!granted) {
        await extensionApi.runtime.sendMessage({ type: "search-tabs:cancel-enable", tabId: targetTab.id, origin });
        message = messages.denied;
        return;
      }
      type = "search-tabs:complete-enable";
    }
    const result = await extensionApi.runtime.sendMessage({ type, tabId: targetTab.id, origin });
    if (!result?.ok) message = messages[result?.reason] || messages.error;
    else if (result.accessRemoved === false) message = messages.accessWarning;
  } catch {
    message = messages.error;
  } finally {
    busy = false;
    try { await refresh(); } catch { message = messages.error; }
    feedback = message;
    render();
  }
});

initialize().catch(() => { context.pageState = origin ? "unknown" : "unavailable"; feedback = messages.unknown; render(); });
setInterval(() => { refresh().catch(() => { feedback = messages.unknown; render(); }); }, 1000);
