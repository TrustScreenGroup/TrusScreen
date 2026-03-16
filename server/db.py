import sqlite3
from pathlib import Path
from datetime import datetime
from urllib.parse import urlparse

DB_PATH = Path(__file__).parent / "db.db"


def get_conn():
    return sqlite3.connect(DB_PATH, check_same_thread=False)


def init_db():
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("""
        CREATE TABLE IF NOT EXISTS sites (
            domain TEXT PRIMARY KEY,
            is_phishing INTEGER,
            last_checked TEXT
        )
    """)
    conn.commit()
    conn.close()


def extract_domain(url: str) -> str:
    parsed = urlparse(url)
    domain = parsed.netloc.lower()
    parts = domain.split('.')
    if len(parts) >= 2:
        return '.'.join(parts[-2:])
    return domain


def get_site(url: str):
    domain = extract_domain(url)
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("SELECT is_phishing FROM sites WHERE domain = ?", (domain,))
    row = cur.fetchone()
    conn.close()
    return row


def insert_or_update(url: str, is_phishing: int):
    domain = extract_domain(url)
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("""
        INSERT OR REPLACE INTO sites (domain, is_phishing, last_checked)
        VALUES (?, ?, ?)
    """, (domain, is_phishing, datetime.utcnow().isoformat()))
    conn.commit()
    conn.close()


def get_safe_sites_for_recheck():
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("SELECT domain FROM sites WHERE is_phishing = 0")
    rows = cur.fetchall()
    conn.close()
    return [r[0] for r in rows]


def get_training_data():
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("""
        SELECT domain, is_phishing FROM sites
        WHERE is_phishing IN (0,1)
    """)
    rows = cur.fetchall()
    conn.close()
    return rows

def get_conn():
    return sqlite3.connect("db.db")
