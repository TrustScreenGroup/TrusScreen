const TRUST_DB_NAME = "trustscreen-cache";
const TRUST_DB_VERSION = 1;
const PHISHING_STORE = "phishing_domains";
const META_STORE = "meta";

function openTrustDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(TRUST_DB_NAME, TRUST_DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(PHISHING_STORE)) {
        db.createObjectStore(PHISHING_STORE, { keyPath: "domain" });
      }
      if (!db.objectStoreNames.contains(META_STORE)) {
        db.createObjectStore(META_STORE, { keyPath: "key" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function txPromise(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

function extractDomain(urlOrDomain) {
  if (!urlOrDomain) {
    return null;
  }

  let hostname = String(urlOrDomain).trim().toLowerCase();

  try {
    hostname = new URL(hostname).hostname.toLowerCase();
  } catch (_) {
    try {
      hostname = new URL(`https://${hostname}`).hostname.toLowerCase();
    } catch (_) {
    }
  }

  hostname = hostname.replace(/^www\./, "");
  const parts = hostname.split(".").filter(Boolean);

  if (parts.length >= 2) {
    return `${parts[parts.length - 2]}.${parts[parts.length - 1]}`;
  }

  return hostname || null;
}

async function replacePhishingDomains(domains) {
  const db = await openTrustDb();
  const tx = db.transaction([PHISHING_STORE], "readwrite");
  const store = tx.objectStore(PHISHING_STORE);

  store.clear();

  for (const item of domains || []) {
    const domain = extractDomain(item);
    if (!domain) {
      continue;
    }
    store.put({ domain, updatedAt: Date.now() });
  }

  await txPromise(tx);
  db.close();
}

async function addPhishingDomain(urlOrDomain) {
  const domain = extractDomain(urlOrDomain);
  if (!domain) {
    return;
  }

  const db = await openTrustDb();
  const tx = db.transaction([PHISHING_STORE], "readwrite");
  tx.objectStore(PHISHING_STORE).put({ domain, updatedAt: Date.now() });
  await txPromise(tx);
  db.close();
}

async function isPhishingDomain(urlOrDomain) {
  const domain = extractDomain(urlOrDomain);
  if (!domain) {
    return false;
  }

  const db = await openTrustDb();
  const tx = db.transaction([PHISHING_STORE], "readonly");
  const request = tx.objectStore(PHISHING_STORE).get(domain);

  const result = await new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  await txPromise(tx);
  db.close();
  return Boolean(result);
}

async function setMeta(key, value) {
  const db = await openTrustDb();
  const tx = db.transaction([META_STORE], "readwrite");
  tx.objectStore(META_STORE).put({ key, value });
  await txPromise(tx);
  db.close();
}

async function getMeta(key) {
  const db = await openTrustDb();
  const tx = db.transaction([META_STORE], "readonly");
  const request = tx.objectStore(META_STORE).get(key);

  const result = await new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  await txPromise(tx);
  db.close();
  return result ? result.value : null;
}

self.trustedStorage = {
  extractDomain,
  replacePhishingDomains,
  addPhishingDomain,
  isPhishingDomain,
  setMeta,
  getMeta
};
