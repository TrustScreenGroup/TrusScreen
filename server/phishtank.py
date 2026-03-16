import requests
from urllib.parse import quote_plus

PHISHTANK_API_URL = "https://checkurl.phishtank.com/checkurl/"
PHISHTANK_API_KEY = "PUT_YOUR_API_KEY_HERE"

def check_url(url: str):
    payload = {
        "url": quote_plus(url),
        "format": "json",
        "app_key": PHISHTANK_API_KEY
    }

    try:
        r = requests.post(PHISHTANK_API_URL, data=payload, timeout=5)
        data = r.json()

        result = data.get("results", {})
        return {
            "in_database": result.get("in_database", False),
            "valid": result.get("valid", False),
            "verified": result.get("verified", False)
        }

    except Exception:
        return {
            "in_database": False,
            "valid": False,
            "verified": False
        }
