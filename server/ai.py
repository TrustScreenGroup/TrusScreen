import re
import requests
from bs4 import BeautifulSoup
from pathlib import Path
import joblib
import numpy as np
from urllib.parse import urlparse
import logging

logger = logging.getLogger(__name__)

MODEL_PATH = Path(__file__).parent / "model.pkl"
REQUEST_TIMEOUT = 10


def extract_features(url: str, html: str = "") -> list:
    features = []

    url_lower = url.lower()
    suspicious_keywords = ["login", "secure", "verify", "account", "bank", "update", "signin", "wallet"]
    features.append(int(any(kw in url_lower for kw in suspicious_keywords)))

    parsed = urlparse(url)
    domain = parsed.netloc.lower()

    features.append(min(len(url), 200) / 200.0)
    features.append(int(re.match(r"\d+\.\d+\.\d+\.\d+", domain) is not None))
    features.append(int(domain.count(".") > 2))
    features.append(int("@" in url))
    features.append(int(parsed.scheme == "https"))

    soup = BeautifulSoup(html, "html.parser") if html else BeautifulSoup("", "html.parser")

    features.append(int(bool(soup.find("input", {"type": "password"}))))
    
    forms = soup.find_all("form")
    features.append(min(len(forms), 5) / 5.0)

    links = soup.find_all("a")
    features.append(min(len(links), 100) / 100.0)

    text = soup.get_text().lower()
    urgent_words = ["urgent", "immediately", "click now", "act now", "suspended", "locked"]
    features.append(int(any(w in text for w in urgent_words)))

    external_links = sum(
        1 for link in links
        if (href := link.get("href")) and href.startswith("http") and domain not in href
    )
    ext_ratio = external_links / len(links) if links else 0
    features.append(ext_ratio)

    return features


def load_model():
    if MODEL_PATH.exists():
        try:
            return joblib.load(MODEL_PATH)
        except Exception as e:
            logger.warning(f"Failed to load model: {e}")
    return None


def fetch_html(url: str) -> str:
    url = url.strip()
    try:
        headers = {"User-Agent": "TrustScreen-AI/1.0"}
        resp = requests.get(url, timeout=REQUEST_TIMEOUT, headers=headers)
        resp.raise_for_status()
        return resp.text
    except Exception as e:
        logger.debug(f"HTML fetch failed for {url}: {e}")
        return ""


def analyze_url(url: str) -> float:
    html = fetch_html(url)
    features = extract_features(url, html)

    model = load_model()
    if model is not None:
        X = np.array([features])
        return float(model.predict_proba(X)[0][1])
    else:
        heuristic = sum(features[:6]) / 6.0
        return min(heuristic, 0.95)
def retrain(samples: list[tuple[str, int]]):
    if not samples:
        logger.warning("No samples provided for retraining")
        return

    labels = [label for _, label in samples]
    if len(set(labels)) < 2:
        logger.warning("Not enough class diversity for retraining")
        return

    X, y = [], []
    for url, label in samples:
        html = fetch_html(url)
        features = extract_features(url, html)
        X.append(features)
        y.append(label)

    model = LogisticRegression(max_iter=1000, random_state=42)
    model.fit(X, y)
    joblib.dump(model, MODEL_PATH)
    logger.info(f"Model retrained and saved to {MODEL_PATH}")
