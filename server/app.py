import logging
from fastapi import FastAPI, Request, Query
from models import AnalyzeResponse
from db import init_db, get_site, insert_or_update, extract_domain, get_conn
from ai import analyze_url
from phishtank import check_url
import threading
from scheduler import scheduler_loop

logging.basicConfig(level=logging.DEBUG, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

app = FastAPI(title="PhishGuard API")

@app.middleware("http")
async def log_requests(request: Request, call_next):
    logger.info(f"--- ASGI Request Received ---")
    logger.info(f"Method: {request.method}")
    logger.info(f"URL: {str(request.url)}")
    logger.info(f"Headers: {dict(request.headers)}")
    
    try:
        body = await request.body()
        logger.info(f"Body: {body}")
    except Exception as e:
        logger.error(f"Error reading body: {e}")
        
    response = await call_next(request)
    return response

@app.on_event("startup")
def startup():
    init_db()
    threading.Thread(target=scheduler_loop, daemon=True).start()

@app.get("/api/trusted-list")
async def get_trusted_list():
    try:
        conn = get_conn()
        cur = conn.cursor()
        cur.execute("SELECT domain, is_phishing FROM sites WHERE is_phishing IN (0, 1)")
        rows = cur.fetchall()
        conn.close()

        safe = [domain for domain, status in rows if status == 0]
        phishing = [domain for domain, status in rows if status == 1]

        return {"safe": safe, "phishing": phishing}
    except Exception as e:
        logger.error(f"Database error in /api/trusted-list: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")

@app.get("/analyze", response_model=AnalyzeResponse)
async def analyze_page(request: Request, url: str = Query(...)):
    original_url = url
    url = url.strip()
    domain = extract_domain(url)
    logger.info(f"--- Новый запрос на /analyze ---")
    logger.info(f"Original URL: '{original_url}' -> Domain: '{domain}'")

    site = get_site(url)
    logger.info(f"get_site('{domain}') returned: {site}")

    if site:
        status = site[0]
        logger.info(f"Status from DB: {status}")

        if status == 1:
            logger.info("Returning cached phishing (100% confirmed)")
            return AnalyzeResponse(
                verdict="phishing",
                score=1.0,
                reasons=["Домен подтверждён как фишинговый"]
            )
        elif status == 0:
            logger.info("Returning cached safe (100% safe)")
            return AnalyzeResponse(
                verdict="safe",
                score=0.0,
                reasons=["Домен подтверждён как безопасный"]
            )
        else:
            logger.info(f"Status is {status} -> continuing analysis")

    logger.info("Checking PhishTank...")
    pt = check_url(url)
    if pt.get("valid") and pt.get("verified"):
        insert_or_update(url, 1)
        logger.info("PhishTank confirmed phishing -> returning phishing")
        return AnalyzeResponse(
            verdict="phishing",
            score=1.0,
            reasons=["Подтверждено PhishTank"]
        )

    logger.info("Running AI analysis...")
    ml_score = analyze_url(url)
    logger.info(f"AI Score: {ml_score}")

    if ml_score <= 0.5:
        verdict = "safe"
        reasons = ["ML-модель: низкий риск фишинга"]
    else:
        verdict = "suspicious"
        reasons = [
            "Высокая вероятность фишинга по ML-модели",
            "Требуется ручная проверка"
        ]

    insert_or_update(url, 2)
    logger.info(f"Saving result to DB as is_phishing=2 for domain: {domain}")

    return AnalyzeResponse(
        verdict=verdict,
        score=ml_score,
        reasons=reasons
    )
