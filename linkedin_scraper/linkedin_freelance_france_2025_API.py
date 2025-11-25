# ==============================
# linkedin_freelance_france_2025_API.py
# LinkedIn Job Scraper API
# - Headless FastAPI web app
# - Receives search_url + max_pages + optional cookie_text via JSON
# - Background scraping with live progress logs
# ==============================

import os
import time
from threading import Lock
from typing import Optional, Dict, Any, List

import pandas as pd
from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, FileResponse
from pydantic import BaseModel
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.support.ui import WebDriverWait
from selenium.common.exceptions import (
    TimeoutException,
    ElementClickInterceptedException,
    NoSuchElementException,
    StaleElementReferenceException,
)
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.chrome.service import Service

# ==============================
# FastAPI app + global state
# ==============================

app = FastAPI(title="LinkedIn Job Scraper API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # for dev
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

SCRAPE_STATE: Dict[str, Any] = {
    "running": False,
    "logs": [],
    "result": None,
}
state_lock = Lock()


def log(msg: str):
    """Print to console AND store in shared progress state."""
    print(msg)
    with state_lock:
        SCRAPE_STATE["logs"].append(msg)
        if len(SCRAPE_STATE["logs"]) > 200:
            SCRAPE_STATE["logs"] = SCRAPE_STATE["logs"][-200:]


# ==============================
# Request model
# ==============================

class ScrapeRequest(BaseModel):
    search_url: str
    max_pages: Optional[int] = 50
    cookie_text: Optional[str] = None  # Netscape cookie file content


# ==============================
# Selenium driver setup
# ==============================

def setup_driver(headless: bool = True):
    options = Options()

    if headless:
        options.add_argument("--headless=new")

    options.add_argument("--disable-blink-features=AutomationControlled")
    options.add_argument("--no-sandbox")
    options.add_argument("--disable-dev-shm-usage")
    options.add_argument("--window-size=1920,1080")
    options.add_experimental_option("excludeSwitches", ["enable-automation"])
    options.add_experimental_option("useAutomationExtension", False)

    chromedriver_path = r"C:\Program Files\Google\Chrome\Application\chromedriver-win64\chromedriver.exe"
    service = Service(executable_path=chromedriver_path)
    driver = webdriver.Chrome(service=service, options=options)
    driver.maximize_window()
    return driver


# ==============================
# Parse & load cookies
# ==============================

def parse_netscape_cookies(text: str) -> List[dict]:
    cookies: List[dict] = []
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        parts = line.split("\t")
        if len(parts) < 7:
            continue
        domain, _flag, path, secure, expiry, name, value = parts[:7]
        cookie: Dict[str, Any] = {
            "name": name.strip(),
            "value": value.strip(),
            "domain": domain.lstrip("."),
            "path": path,
            "secure": secure.upper() == "TRUE",
            "httpOnly": False,
            "sameSite": "Lax",
        }
        if expiry != "0":
            try:
                cookie["expiry"] = int(expiry)
            except ValueError:
                pass
        cookies.append(cookie)
    return cookies


def load_cookies(
    driver,
    cookie_text: Optional[str] = None,
    cookie_file: str = "LINKEDIN_COOKIES.txt",
):
    # If cookie_text wasn't passed, try to load from file in same folder
    if cookie_text is None:
        file_path = os.path.join(BASE_DIR, cookie_file)
        if not os.path.exists(file_path):
            log("⚠️  LINKEDIN_COOKIES.txt not found → You must log in manually first")
            return
        with open(file_path, "r", encoding="utf-8") as f:
            cookie_text = f.read()

    # At this point we have some Netscape cookie text
    driver.get("https://www.linkedin.com")
    time.sleep(3)

    cookies = parse_netscape_cookies(cookie_text)
    added = 0
    for cookie in cookies:
        try:
            driver.add_cookie(cookie)
            added += 1
        except Exception:
            pass

    log(f"✅ Cookies loaded successfully ({added} entries)")
    driver.refresh()
    time.sleep(4)


# ==============================
# Scroll to load all jobs
# ==============================

def scroll_to_bottom_by_last_job(driver, max_scrolls=300):
    log("🔄 Starting ultimate scroll-to-last-job method (2025-proof)...")
    WebDriverWait(driver, 30).until(
        EC.presence_of_element_located(
            (By.CSS_SELECTOR, ".job-card-container--clickable")
        )
    )
    time.sleep(3)

    no_progress = 0
    for _ in range(max_scrolls):
        job_cards = driver.find_elements(
            By.CSS_SELECTOR, ".job-card-container--clickable"
        )
        current_count = len(job_cards)

        if current_count == 0:
            time.sleep(3)
            continue

        driver.execute_script(
            "arguments[0].scrollIntoView({block: 'center'});", job_cards[-1]
        )
        driver.execute_script("window.scrollBy(0, -120);")
        time.sleep(2.8)

        new_cards = driver.find_elements(
            By.CSS_SELECTOR, ".job-card-container--clickable"
        )
        new_count = len(new_cards)

        if new_count > current_count:
            log(f"   +{new_count - current_count} new jobs → Total: {new_count}")
            no_progress = 0
        else:
            no_progress += 1
            log(f"   No new jobs ({no_progress}/12)")

        if no_progress >= 12:
            log("✅ No more jobs loading → Page fully loaded")
            break

    final_count = len(
        driver.find_elements(By.CSS_SELECTOR, ".job-card-container--clickable")
    )
    log(f"🎉 PAGE FULLY LOADED → {final_count} jobs visible")
    return final_count


# ==============================
# Pagination
# ==============================

def go_to_next_page(driver, current_page=1):
    log(f"➡️ Attempting to go to page {current_page + 1}...")
    try:
        next_button = WebDriverWait(driver, 10).until(
            EC.element_to_be_clickable(
                (By.CSS_SELECTOR, "button.jobs-search-pagination__button--next")
            )
        )
        driver.execute_script(
            "arguments[0].scrollIntoView({block: 'center'});", next_button
        )
        time.sleep(1)

        try:
            next_button.click()
        except ElementClickInterceptedException:
            driver.execute_script("arguments[0].click();", next_button)

        log("✅ Next button clicked")
        time.sleep(4)
        driver.execute_script("window.scrollBy(0, 500);")
        time.sleep(3)
        return current_page + 1

    except TimeoutException:
        log("🚫 No 'Next' button → End of pagination")
        return False
    except Exception as e:
        log(f"⚠️ Error clicking next: {e}")
        return False


# ==============================
# Single job extraction
# ==============================

def extract_job(driver, card, index):
    job = {
        "REF": index,
        "Company": "",
        "Company industry": "",
        "Number of employee": "",
        "Company description": "",
        "Job Title": "",
        "Location": "",
        "Recruiter name": "",
        "Recruiter URL profile": "",
        "Recruiter presentation": "",
        "Job description": "",
        "Job URL": "",
    }

    try:
        link = card.find_element(By.CSS_SELECTOR, "a.job-card-list__title--link")
        job["Job Title"] = link.text.strip()
        job["Job URL"] = link.get_attribute("href").split("?")[0]
    except Exception:
        pass

    try:
        job["Company"] = card.find_element(
            By.CSS_SELECTOR, ".artdeco-entity-lockup__subtitle span"
        ).text.strip()
    except Exception:
        pass

    try:
        job["Location"] = card.find_element(
            By.CSS_SELECTOR, ".job-card-container__metadata-wrapper li"
        ).text.strip()
    except Exception:
        pass

    driver.execute_script("arguments[0].scrollIntoView({block: 'center'});", card)
    time.sleep(1)
    try:
        card.click()
    except Exception:
        driver.execute_script("arguments[0].click();", card)
    time.sleep(5)

    try:
        info = driver.find_element(By.CSS_SELECTOR, "div.t-14.mt5").text
        parts = info.split("·")
        job["Company industry"] = parts[0].strip()
        for p in parts:
            if "employee" in p.lower():
                job["Number of employee"] = p.strip()
    except Exception:
        pass

    try:
        job["Company description"] = driver.find_element(
            By.CSS_SELECTOR, "p.jobs-company__company-description"
        ).text.strip()
    except Exception:
        pass

    try:
        desc = driver.find_element(
            By.CSS_SELECTOR,
            "#job-details, .jobs-box__html-content, .jobs-description-content__text",
        )
        job["Job description"] = desc.text.strip()
    except Exception:
        pass

    try:
        sec = driver.find_element(
            By.CSS_SELECTOR, ".job-details-people-who-can-help__section--two-pane"
        )
        try:
            job["Recruiter name"] = sec.find_element(
                By.CSS_SELECTOR, "span.jobs-poster__name strong"
            ).text.strip()
        except Exception:
            pass
        try:
            profile = sec.find_element(By.XPATH, ".//a[contains(@href,'/in/')]")
            job["Recruiter URL profile"] = profile.get_attribute(
                "href"
            ).split("?")[0]
        except Exception:
            pass
        try:
            job["Recruiter presentation"] = sec.find_element(
                By.CSS_SELECTOR, "div.text-body-small.t-black"
            ).text.strip()
        except Exception:
            pass
    except Exception:
        pass

    return job


# ==============================
# Core scraper
# ==============================

def run_scraper(search_url: str, max_pages: int = 50, cookie_text: Optional[str] = None):
    driver = setup_driver(headless=True)
    results = []

    try:
        load_cookies(driver, cookie_text=cookie_text)

        driver.get(search_url)
        time.sleep(10)

        current_page = 1
        total_jobs_extracted = 0

        while current_page <= max_pages:
            log("=" * 60)
            log(f"                   PAGE {current_page}")
            log("=" * 60)

            scroll_to_bottom_by_last_job(driver)

            cards = driver.find_elements(
                By.CSS_SELECTOR, ".job-card-container--clickable"
            )
            log(f"📌 Extracting {len(cards)} jobs from page {current_page}...")

            for i, card in enumerate(cards, 1):
                try:
                    data = extract_job(driver, card, total_jobs_extracted + i)
                    results.append(data)
                    log(
                        f"  {total_jobs_extracted + i:3d}. "
                        f"{data['Job Title'][:60]:60} → {data['Recruiter name'] or '—'}"
                    )
                except (StaleElementReferenceException, Exception) as e:
                    log(f"  ⚠️ Skipped job {i}: {e}")

            total_jobs_extracted += len(cards)

            next_page = go_to_next_page(driver, current_page)
            if not next_page:
                log("🎉 No more pages → Scraping finished!")
                break
            current_page = next_page
            time.sleep(5)

        df = pd.DataFrame(results)
        columns_order = [
            "REF",
            "Company",
            "Company industry",
            "Number of employee",
            "Company description",
            "Job Title",
            "Location",
            "Recruiter name",
            "Recruiter URL profile",
            "Recruiter presentation",
            "Job description",
            "Job URL",
        ]
        if not df.empty:
            df = df[columns_order]

        timestamp = time.strftime("%Y%m%d_%H%M%S")
        filename = f"linkedin_jobs_{timestamp}.csv"
        file_path = os.path.join(BASE_DIR, filename)
        df.to_csv(file_path, index=False, encoding="utf-8-sig")
        log(f"🎊 SUCCESS! {len(results)} jobs saved → {filename}")

        return {
            "status": "ok",
            "total_jobs": len(results),
            "file": filename,
        }

    finally:
        driver.quit()


# ==============================
# Background task wrapper
# ==============================

def run_scraper_task(search_url: str, max_pages: int = 50, cookie_text: Optional[str] = None):
    with state_lock:
        SCRAPE_STATE["running"] = True
        SCRAPE_STATE["logs"] = []
        SCRAPE_STATE["result"] = None

    try:
        result = run_scraper(search_url, max_pages, cookie_text=cookie_text)
        with state_lock:
            SCRAPE_STATE["result"] = result
    except Exception as e:
        with state_lock:
            SCRAPE_STATE["result"] = {"status": "error", "detail": str(e)}
            SCRAPE_STATE["logs"].append(f"ERROR: {e}")
    finally:
        with state_lock:
            SCRAPE_STATE["running"] = False


# ==============================
# API endpoints
# ==============================

# Direct endpoint (still usable)
@app.post("/scrape")
def scrape_linkedin(req: ScrapeRequest):
    try:
        result = run_scraper(req.search_url, req.max_pages, cookie_text=req.cookie_text)
        return result
    except Exception as e:
        return JSONResponse(
            status_code=500,
            content={"status": "error", "detail": str(e)},
        )


# Async flow: start + status for live progress
@app.post("/scrape_start")
def scrape_start(req: ScrapeRequest, background_tasks: BackgroundTasks):
    with state_lock:
        if SCRAPE_STATE["running"]:
            raise HTTPException(status_code=409, detail="A scrape is already running")
        SCRAPE_STATE["logs"] = ["Starting scrape..."]
        SCRAPE_STATE["result"] = None
        SCRAPE_STATE["running"] = True

    background_tasks.add_task(
        run_scraper_task,
        req.search_url,
        req.max_pages,
        req.cookie_text,
    )
    return {"status": "started"}


@app.get("/scrape_status")
def scrape_status():
    with state_lock:
        return {
            "running": SCRAPE_STATE["running"],
            "logs": list(SCRAPE_STATE["logs"]),
            "result": SCRAPE_STATE["result"],
        }


@app.get("/download/{filename}")
def download_csv(filename: str):
    safe_name = os.path.basename(filename)
    file_path = os.path.join(BASE_DIR, safe_name)

    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="File not found")

    return FileResponse(
        file_path,
        media_type="text/csv",
        filename=safe_name,
    )
