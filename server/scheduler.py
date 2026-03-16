import time
import logging
from db import get_safe_sites_for_recheck, insert_or_update, get_training_data
from ai import analyze_url

logger = logging.getLogger(__name__)

def scheduler_loop():
    while True:
        try:
            logger.info("Scheduler: checking safe sites for re-analysis...")
            urls = get_safe_sites_for_recheck()
            for url in urls:
                score = analyze_url(url)
                if score > 0.8:
                    logger.warning(f"Previously safe site now looks phishing: {url}")
                    insert_or_update(url, 1)
            time.sleep(3600)
        except Exception as e:
            logger.error(f"Scheduler error: {e}")
            time.sleep(60)
