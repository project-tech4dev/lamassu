// TEST ONLY: point the popup at the Drive tab given in ?tab=.
const __tab = Number(new URLSearchParams(location.search).get('tab'));
chrome.tabs.query = async () => [{ id: __tab }];
