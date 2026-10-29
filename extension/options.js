const extensionApi = globalThis.browser || globalThis.chrome;
const translations = {
  en: {
    startTitle: "Get started", startBody: "Sign in to your Zammad workspace and open this extension's toolbar panel. Choose Allow access and enable, then approve your browser's site access request. Search tabs will start automatically. If access is already allowed, choose Enable on this site.",
    editing: "The global search opens another tab. The search field in the results area and the filter builder edit the current tab.",
    tabControls: "Hover over a search tab and click the pencil to name it. Leave the name empty to show the query again. Drag tabs to reorder them, or focus a tab and press Alt + Up or Alt + Down.",
    privateTitle: "Private windows", privateAllowed: "Browser permission for private windows is allowed.", privateBlocked: "Browser permission for private windows is not allowed yet.",
    privateSetup: "Open the extension's details in your browser and turn on Allow in incognito. Then sign in to Zammad in a private window and enable the extension there.",
    privateData: "By default, private queries, tab names and tab order are kept in memory, separately from regular windows, and removed when the last private window closes. Enable the site again for each new private session.",
    sharePrivate: "Use shared saved searches in private windows",
    sharePrivateHelp: "When enabled, private windows use the regular profile's searches for the same Zammad address and account. Changes remain after private windows close. Turning this off does not remove data already saved in the regular profile. Temporary searches remain separate until the private session ends.",
    privateShared: "Private windows now use shared saved searches.", privateSeparate: "Private windows now use separate temporary searches.",
    sitesTitle: "Enabled sites", noSites: "No sites are enabled.", saved: "Saved searches: ",
    privacyTitle: "Your data", privacyBody: "Search text is saved locally in this browser profile, grouped by the Zammad address and account ID. Queries can contain personal or confidential information. The extension also reads your locale and the state, priority and group labels needed by the filter builder.",
    localOnly: "The extension sends no data to the developer or third parties. It has no analytics, advertising, cloud sync or remote code.",
    clear: "Disable all sites and remove saved searches", confirm: "Remove all saved searches and disable the extension on every enabled site? This cannot be undone.",
    removed: "Saved searches were removed and site access was disabled. You can enable a site again with the toolbar icon.", error: "Could not complete this action. Please try again.",
    accessWarning: "Saved searches were removed and the integration is disabled. The browser could not remove site access; you can remove it in your browser's extension settings.",
    privacyLink: "Privacy policy", independent: "Independent extension. Not affiliated with or endorsed by Zammad GmbH or the Zammad Foundation."
  },
  pl: {
    startTitle: "Pierwsze kroki", startBody: "Zaloguj się do Zammad i otwórz panel rozszerzenia. Wybierz Zezwól na dostęp i włącz, a następnie zatwierdź prośbę przeglądarki. Zakładki włączą się automatycznie. Jeśli dostęp jest już udzielony, wybierz Włącz w tej witrynie.",
    editing: "Wyszukiwanie globalne otwiera kolejną zakładkę. Pole w obszarze wyników i kreator filtrów zmieniają bieżącą zakładkę.",
    tabControls: "Najedź na zakładkę wyszukiwania i kliknij ołówek, aby nadać jej nazwę. Pusta nazwa przywraca tekst zapytania. Przeciągaj zakładki, aby zmienić kolejność, albo ustaw fokus na zakładce i naciśnij Alt + strzałka w górę lub w dół.",
    privateTitle: "Okna prywatne", privateAllowed: "Przeglądarka zezwala na działanie w oknach prywatnych.", privateBlocked: "Przeglądarka jeszcze nie zezwala na działanie w oknach prywatnych.",
    privateSetup: "Otwórz szczegóły rozszerzenia w przeglądarce i włącz Zezwalaj w trybie incognito. Następnie zaloguj się do Zammad w oknie prywatnym i włącz tam rozszerzenie.",
    privateData: "Domyślnie prywatne zapytania, nazwy zakładek i ich kolejność są przechowywane w pamięci, oddzielnie od zwykłych okien, i znikają po zamknięciu ostatniego prywatnego okna. W każdej nowej sesji prywatnej włącz witrynę ponownie.",
    sharePrivate: "Używaj wspólnych zapisanych wyszukiwań w oknach prywatnych",
    sharePrivateHelp: "Po włączeniu okna prywatne używają wyszukiwań ze zwykłego profilu dla tego samego adresu i konta Zammad. Zmiany pozostają po zamknięciu okien prywatnych. Wyłączenie tej opcji nie usuwa danych już zapisanych w zwykłym profilu. Tymczasowe wyszukiwania pozostają oddzielne do końca sesji prywatnej.",
    privateShared: "Okna prywatne używają teraz wspólnych zapisanych wyszukiwań.", privateSeparate: "Okna prywatne używają teraz oddzielnych tymczasowych wyszukiwań.",
    sitesTitle: "Włączone witryny", noSites: "Nie włączono żadnej witryny.", saved: "Zapisane wyszukiwania: ",
    privacyTitle: "Twoje dane", privacyBody: "Tekst zapytań jest zapisywany lokalnie w tym profilu przeglądarki, osobno dla adresu Zammad i identyfikatora konta. Zapytania mogą zawierać dane osobowe lub poufne. Rozszerzenie odczytuje też język oraz nazwy stanów, priorytetów i grup potrzebne w kreatorze filtrów.",
    localOnly: "Rozszerzenie nie wysyła danych do autora ani do innych podmiotów. Nie zawiera analityki, reklam, synchronizacji w chmurze ani zdalnego kodu.",
    clear: "Wyłącz wszystkie witryny i usuń zapisane wyszukiwania", confirm: "Usunąć wszystkie zapisane wyszukiwania i wyłączyć rozszerzenie we wszystkich witrynach? Tej operacji nie można cofnąć.",
    removed: "Usunięto zapisane wyszukiwania i wyłączono dostęp do witryn. Witrynę można włączyć ponownie ikoną na pasku przeglądarki.", error: "Nie udało się wykonać operacji. Spróbuj ponownie.",
    accessWarning: "Usunięto zapisane wyszukiwania i wyłączono integrację. Przeglądarka nie usunęła dostępu do witryn; można go usunąć w ustawieniach rozszerzenia w przeglądarce.",
    privacyLink: "Polityka prywatności", independent: "Niezależne rozszerzenie. Nie jest powiązane z Zammad GmbH ani Zammad Foundation i nie jest przez nie zatwierdzone."
  }
};

const messages = translations[extensionApi.i18n.getUILanguage().slice(0, 2)] || translations.en;
document.documentElement.lang = messages === translations.pl ? "pl" : "en";
document.querySelectorAll("[data-message]").forEach(element => { element.textContent = messages[element.dataset.message]; });

async function render() {
  const privateAllowed = await extensionApi.extension.isAllowedIncognitoAccess();
  document.querySelector("#private-status").textContent = privateAllowed ? messages.privateAllowed : messages.privateBlocked;
  const stored = await extensionApi.storage.local.get(null);
  document.querySelector("#share-private-searches").checked = stored.sharePrivateSearches === true;
  const sites = stored.enabledSites || [];
  const list = document.querySelector("#sites");
  list.replaceChildren();
  for (const site of sites.length ? sites : [messages.noSites]) {
    const item = document.createElement("li");
    item.textContent = site.replace(/\/\*$/, "");
    list.append(item);
  }
  const count = Object.entries(stored).filter(([key, value]) => key.startsWith("searches:") && Array.isArray(value)).reduce((total, [, searches]) => total + searches.length, 0);
  document.querySelector("#saved-count").textContent = messages.saved + count;
}

document.querySelector("#share-private-searches").addEventListener("change", async event => {
  const checkbox = event.currentTarget;
  const status = document.querySelector("#private-sharing-status");
  const enabled = checkbox.checked;
  checkbox.disabled = true;
  try {
    const result = await extensionApi.runtime.sendMessage({ type: "search-tabs:share-private", enabled });
    if (!result?.ok) throw new Error(messages.error);
    await render();
    status.textContent = enabled ? messages.privateShared : messages.privateSeparate;
  } catch {
    checkbox.checked = !enabled;
    status.textContent = messages.error;
  } finally {
    checkbox.disabled = false;
  }
});

document.querySelector("#clear-data").addEventListener("click", async event => {
  if (!confirm(messages.confirm)) return;
  const button = event.currentTarget;
  const status = document.querySelector("#status");
  button.disabled = true;
  try {
    const result = await extensionApi.runtime.sendMessage({ type: "search-tabs:clear" });
    if (!result?.ok) throw new Error(messages.error);
    await render();
    status.textContent = result.accessRemoved === false ? messages.accessWarning : messages.removed;
  } catch {
    status.textContent = messages.error;
  } finally {
    button.disabled = false;
  }
});

render().catch(() => { document.querySelector("#status").textContent = messages.error; });
