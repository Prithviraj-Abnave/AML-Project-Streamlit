"""
Topic Modeling Dashboard — Streamlit Application
=================================================
Compares LDA vs NMF topic models on Amazon product reviews.
Supports deployment to Streamlit Community Cloud, Hugging Face, Docker, and local run.
Preserves 100% of functionality, academic research design, libraries, and interface.
"""

import gc
import json
import os
import socket
import threading
from typing import Any

import streamlit as st
import streamlit.components.v1 as components
from jinja2 import Environment, FileSystemLoader

from ml.pipeline import (
    get_results,
    get_status,
    load_cached_results,
    load_custom_results,
    run_pipeline,
)
from routes.api import _run_scrape_pipeline

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
RESULTS_FILE = os.path.join(BASE_DIR, "results", "results.json")
CUSTOM_RESULTS_FILE = os.path.join(BASE_DIR, "results", "custom_results.json")
CSS_FILE = os.path.join(BASE_DIR, "static", "css", "style.css")
JS_FILE = os.path.join(BASE_DIR, "static", "js", "app.js")
CHART_JS_FILE = os.path.join(BASE_DIR, "static", "js", "chart.min.js")
UPLOADS_DIR = os.path.join(BASE_DIR, "uploads")
os.makedirs(UPLOADS_DIR, exist_ok=True)

# ─────────────────────────────────────────────────────────────
# 1. API Route Registration (Starlette & Tornado)
# ─────────────────────────────────────────────────────────────

CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With",
}


def _make_starlette_routes():
    """Create Starlette routes for the topic modeling API."""
    from starlette.responses import JSONResponse, Response
    from starlette.routing import Route

    async def handle_options(request):
        return Response("", status_code=200, headers=CORS_HEADERS)

    async def handle_status(request):
        if request.method == "OPTIONS":
            return Response("", status_code=200, headers=CORS_HEADERS)
        return JSONResponse(get_status(), headers=CORS_HEADERS)

    async def handle_results(request):
        if request.method == "OPTIONS":
            return Response("", status_code=200, headers=CORS_HEADERS)
        data = get_results() or load_cached_results()
        if data is None:
            return JSONResponse(
                {"error": "No results available. Run the analysis first."},
                status_code=404,
                headers=CORS_HEADERS,
            )
        return JSONResponse(data, headers=CORS_HEADERS)

    async def handle_custom_results(request):
        if request.method == "OPTIONS":
            return Response("", status_code=200, headers=CORS_HEADERS)
        data = load_custom_results()
        if data is None:
            return JSONResponse(
                {"error": "No custom results available."},
                status_code=404,
                headers=CORS_HEADERS,
            )
        return JSONResponse(data, headers=CORS_HEADERS)

    async def handle_scrape(request):
        if request.method == "OPTIONS":
            return Response("", status_code=200, headers=CORS_HEADERS)
        current = get_status()
        if current.get("status") == "running":
            return JSONResponse(
                {"error": "Pipeline is already running."},
                status_code=409,
                headers=CORS_HEADERS,
            )
        try:
            body = await request.json()
        except Exception:
            body = {}
        urls = body.get("urls", [])
        n_topics = int(body.get("n_topics", 5))
        max_pages = int(body.get("max_pages", 3))

        urls = [u for u in urls if u and str(u).strip()]
        if len(urls) < 2:
            return JSONResponse(
                {"error": "Please provide at least 2 product URLs."},
                status_code=400,
                headers=CORS_HEADERS,
            )
        if len(urls) > 4:
            return JSONResponse(
                {"error": "Maximum 4 URLs are supported."},
                status_code=400,
                headers=CORS_HEADERS,
            )
        if n_topics < 2 or n_topics > 20:
            return JSONResponse(
                {"error": "n_topics must be between 2 and 20."},
                status_code=400,
                headers=CORS_HEADERS,
            )

        supported_hosts = (
            "flipkart.com",
            "snapdeal.com",
            "myntra.com",
            "amazon.in",
            "amazon.com",
            "croma.com",
            "reliancedigital.in",
        )
        for url in urls:
            if not any(host in url.lower() for host in supported_hosts):
                return JSONResponse(
                    {
                        "error": f"Unsupported site in URL: {url}. "
                        "Supported: Flipkart, Snapdeal, Myntra, Amazon, Croma, Reliance Digital."
                    },
                    status_code=400,
                    headers=CORS_HEADERS,
                )

        _run_scrape_pipeline(urls, n_topics, max_pages)
        return JSONResponse(
            {
                "message": "Scraping started.",
                "urls": urls,
                "n_topics": n_topics,
            },
            headers=CORS_HEADERS,
        )

    async def handle_analyze(request):
        if request.method == "OPTIONS":
            return Response("", status_code=200, headers=CORS_HEADERS)
        current = get_status()
        if current.get("status") == "running":
            return JSONResponse(
                {"error": "Pipeline is already running."},
                status_code=409,
                headers=CORS_HEADERS,
            )
        try:
            body = await request.json()
        except Exception:
            body = {}
        n_topics = int(body.get("n_topics", 5))
        sample_size = body.get("sample_size")
        if sample_size is not None:
            sample_size = int(sample_size)

        if n_topics < 2 or n_topics > 20:
            return JSONResponse(
                {"error": "n_topics must be between 2 and 20."},
                status_code=400,
                headers=CORS_HEADERS,
            )
        if sample_size is not None and sample_size < 100:
            return JSONResponse(
                {"error": "sample_size must be at least 100."},
                status_code=400,
                headers=CORS_HEADERS,
            )

        run_pipeline(n_topics=n_topics, sample_size=sample_size)
        return JSONResponse(
            {
                "message": "Pipeline started.",
                "n_topics": n_topics,
                "sample_size": sample_size,
            },
            headers=CORS_HEADERS,
        )

    return [
        Route("/api/status", handle_status, methods=["GET", "OPTIONS"]),
        Route("/api/status/", handle_status, methods=["GET", "OPTIONS"]),
        Route("/api/results", handle_results, methods=["GET", "OPTIONS"]),
        Route("/api/results/", handle_results, methods=["GET", "OPTIONS"]),
        Route("/api/custom_results", handle_custom_results, methods=["GET", "OPTIONS"]),
        Route("/api/custom_results/", handle_custom_results, methods=["GET", "OPTIONS"]),
        Route("/api/scrape", handle_scrape, methods=["POST", "OPTIONS"]),
        Route("/api/scrape/", handle_scrape, methods=["POST", "OPTIONS"]),
        Route("/api/analyze", handle_analyze, methods=["POST", "OPTIONS"]),
        Route("/api/analyze/", handle_analyze, methods=["POST", "OPTIONS"]),
    ]


# ─────────────────────────────────────────────────────────────
# Streamlit 1.53+ Native ASGI App (Auto-discovered by Streamlit)
# ─────────────────────────────────────────────────────────────
try:
    from streamlit import App

    app = App("streamlit_app.py", routes=_make_starlette_routes())
except Exception as _app_exc:
    app = None


def _register_server_routes():
    """Dynamically register API routes on the running Starlette/Tornado server."""
    # 1. Starlette server
    try:
        from starlette.applications import Starlette

        for obj in gc.get_objects():
            if isinstance(obj, Starlette):
                routes = getattr(obj.router, "routes", [])
                has_api = any(getattr(r, "path", "") == "/api/status" for r in routes)
                if not has_api:
                    api_routes = _make_starlette_routes()
                    for r in reversed(api_routes):
                        obj.router.routes.insert(0, r)
    except Exception as e:
        print(f"[Warning] Starlette route registration: {e}")

    # 2. Tornado server (fallback for older Streamlit versions)
    try:
        import tornado.web
        from tornado.routing import PathMatches, Rule

        class TornadoStatusHandler(tornado.web.RequestHandler):
            def set_default_headers(self):
                for k, v in CORS_HEADERS.items():
                    self.set_header(k, v)

            def get(self):
                self.set_header("Content-Type", "application/json")
                self.write(json.dumps(get_status()))

            def options(self):
                self.set_status(200)

        class TornadoResultsHandler(tornado.web.RequestHandler):
            def set_default_headers(self):
                for k, v in CORS_HEADERS.items():
                    self.set_header(k, v)

            def get(self):
                self.set_header("Content-Type", "application/json")
                data = get_results() or load_cached_results()
                if not data:
                    self.set_status(404)
                    self.write(json.dumps({"error": "No results available."}))
                else:
                    self.write(json.dumps(data))

            def options(self):
                self.set_status(200)

        class TornadoCustomResultsHandler(tornado.web.RequestHandler):
            def set_default_headers(self):
                for k, v in CORS_HEADERS.items():
                    self.set_header(k, v)

            def get(self):
                self.set_header("Content-Type", "application/json")
                data = load_custom_results()
                if not data:
                    self.set_status(404)
                    self.write(json.dumps({"error": "No custom results available."}))
                else:
                    self.write(json.dumps(data))

            def options(self):
                self.set_status(200)

        class TornadoScrapeHandler(tornado.web.RequestHandler):
            def set_default_headers(self):
                for k, v in CORS_HEADERS.items():
                    self.set_header(k, v)

            def options(self):
                self.set_status(200)

            def post(self):
                self.set_header("Content-Type", "application/json")
                current = get_status()
                if current.get("status") == "running":
                    self.set_status(409)
                    self.write(json.dumps({"error": "Pipeline is already running."}))
                    return
                try:
                    body = json.loads(self.request.body.decode("utf-8")) if self.request.body else {}
                except Exception:
                    body = {}
                urls = body.get("urls", [])
                n_topics = int(body.get("n_topics", 5))
                max_pages = int(body.get("max_pages", 3))

                urls = [u for u in urls if u and str(u).strip()]
                if len(urls) < 2:
                    self.set_status(400)
                    self.write(json.dumps({"error": "Please provide at least 2 product URLs."}))
                    return
                if len(urls) > 4:
                    self.set_status(400)
                    self.write(json.dumps({"error": "Maximum 4 URLs are supported."}))
                    return
                if n_topics < 2 or n_topics > 20:
                    self.set_status(400)
                    self.write(json.dumps({"error": "n_topics must be between 2 and 20."}))
                    return

                supported_hosts = (
                    "flipkart.com", "snapdeal.com", "myntra.com",
                    "amazon.in", "amazon.com", "croma.com", "reliancedigital.in",
                )
                for url in urls:
                    if not any(host in url.lower() for host in supported_hosts):
                        self.set_status(400)
                        self.write(json.dumps({
                            "error": f"Unsupported site in URL: {url}. Supported: Flipkart, Snapdeal, Myntra, Amazon, Croma, Reliance Digital."
                        }))
                        return

                _run_scrape_pipeline(urls, n_topics, max_pages)
                self.write(json.dumps({
                    "message": "Scraping started.",
                    "urls": urls,
                    "n_topics": n_topics,
                }))

        class TornadoAnalyzeHandler(tornado.web.RequestHandler):
            def set_default_headers(self):
                for k, v in CORS_HEADERS.items():
                    self.set_header(k, v)

            def options(self):
                self.set_status(200)

            def post(self):
                self.set_header("Content-Type", "application/json")
                current = get_status()
                if current.get("status") == "running":
                    self.set_status(409)
                    self.write(json.dumps({"error": "Pipeline is already running."}))
                    return
                try:
                    body = json.loads(self.request.body.decode("utf-8")) if self.request.body else {}
                except Exception:
                    body = {}
                n_topics = int(body.get("n_topics", 5))
                sample_size = body.get("sample_size")
                if sample_size is not None:
                    sample_size = int(sample_size)

                if n_topics < 2 or n_topics > 20:
                    self.set_status(400)
                    self.write(json.dumps({"error": "n_topics must be between 2 and 20."}))
                    return
                if sample_size is not None and sample_size < 100:
                    self.set_status(400)
                    self.write(json.dumps({"error": "sample_size must be at least 100."}))
                    return

                run_pipeline(n_topics=n_topics, sample_size=sample_size)
                self.write(json.dumps({
                    "message": "Pipeline started.",
                    "n_topics": n_topics,
                    "sample_size": sample_size,
                }))

        tornado_rules = [
            Rule(PathMatches(r"/api/status/?$"), TornadoStatusHandler),
            Rule(PathMatches(r"/api/results/?$"), TornadoResultsHandler),
            Rule(PathMatches(r"/api/custom_results/?$"), TornadoCustomResultsHandler),
            Rule(PathMatches(r"/api/scrape/?$"), TornadoScrapeHandler),
            Rule(PathMatches(r"/api/analyze/?$"), TornadoAnalyzeHandler),
        ]

        for obj in gc.get_objects():
            if isinstance(obj, tornado.web.Application):
                try:
                    target_rules = obj.default_router.rules[0].target.rules
                    patterns = [getattr(getattr(r, "matcher", None), "regex", getattr(r, "matcher", None)).pattern for r in target_rules if hasattr(getattr(r, "matcher", None), "regex", None)]
                    if not any("/api/status" in p for p in patterns):
                        for rule in reversed(tornado_rules):
                            target_rules.insert(0, rule)
                except Exception:
                    obj.add_handlers(
                        r".*",
                        [
                            (r"/api/status/?", TornadoStatusHandler),
                            (r"/api/results/?", TornadoResultsHandler),
                            (r"/api/custom_results/?", TornadoCustomResultsHandler),
                            (r"/api/scrape/?", TornadoScrapeHandler),
                            (r"/api/analyze/?", TornadoAnalyzeHandler),
                        ],
                    )
    except Exception as e:
        print(f"[Warning] Tornado route registration: {e}")


def _start_flask_background_server():
    """Start Flask server in a background thread on port 5000 as fallback."""

    def _is_port_in_use(port):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            return s.connect_ex(("127.0.0.1", port)) == 0

    if not _is_port_in_use(5000):
        try:
            from app import create_app

            flask_app = create_app()

            def run_flask():
                flask_app.run(host="127.0.0.1", port=5000, debug=False, use_reloader=False)

            t = threading.Thread(target=run_flask, daemon=True)
            t.start()
        except Exception:
            pass


# ─────────────────────────────────────────────────────────────
# 2. Template Compilation & Inlining
# ─────────────────────────────────────────────────────────────


@st.cache_data
def get_compiled_html():
    """Compile the full Jinja dashboard with inlined CSS, JS, and precomputed data."""
    env = Environment(loader=FileSystemLoader(os.path.join(BASE_DIR, "templates")))
    env.globals["url_for"] = lambda endpoint, **val: val.get("filename", "")

    template = env.get_template("dashboard.html")
    html_content = template.render()

    css_content = ""
    if os.path.exists(CSS_FILE):
        with open(CSS_FILE, "r", encoding="utf-8") as f:
            css_content = f.read()

    chart_js_content = ""
    if os.path.exists(CHART_JS_FILE):
        with open(CHART_JS_FILE, "r", encoding="utf-8") as f:
            chart_js_content = f.read()

    js_content = ""
    if os.path.exists(JS_FILE):
        with open(JS_FILE, "r", encoding="utf-8") as f:
            js_content = f.read()

    results_json = "{}"
    if os.path.exists(RESULTS_FILE):
        with open(RESULTS_FILE, "r", encoding="utf-8") as f:
            results_json = f.read()

    # Inline CSS
    css_replacement = f"<style>\n{css_content}\n</style>"
    html_content = html_content.replace(
        '<link rel="stylesheet" href="css/style.css">', css_replacement
    )

    # Inline Chart.js bundle so graphs render 100% reliably without CDN latency or blockers
    if chart_js_content:
        chart_replacement = f"<script>\n{chart_js_content}\n</script>"
        html_content = html_content.replace(
            '<script src="js/chart.min.js"></script>',
            chart_replacement,
        )
        html_content = html_content.replace(
            '<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js"></script>',
            chart_replacement,
        )

    custom_results_json = "{}"
    if os.path.exists(CUSTOM_RESULTS_FILE):
        with open(CUSTOM_RESULTS_FILE, "r", encoding="utf-8") as f:
            custom_results_json = f.read()

    # Inline JS and precomputed benchmarks
    js_replacement = (
        f"<script>\nwindow.INITIAL_DATA = {results_json};\nwindow.CUSTOM_DATA = {custom_results_json};\n</script>\n"
        f"<script>\n{js_content}\n</script>"
    )
    html_content = html_content.replace(
        '<script src="js/app.js"></script>', js_replacement
    )

    return html_content


# ─────────────────────────────────────────────────────────────
# 3. Main Streamlit Execution
# ─────────────────────────────────────────────────────────────


def main():
    st.set_page_config(
        page_title="Topic Analysis | LDA vs NMF",
        page_icon="📊",
        layout="wide",
        initial_sidebar_state="expanded",
    )

    # Ensure API routes are registered on Streamlit's web server
    _register_server_routes()
    _start_flask_background_server()

    # CSS styling to keep Streamlit header, sidebar & Deploy button visible while dashboard fills the screen below
    st.markdown(
        """
        <style>
            /* Main background transparent so iframe shows through */
            .stApp, section.main, .block-container {
                background: transparent !important;
            }

            /* Ensure Streamlit header, toolbar, and Deploy button remain visible and accessible */
            header[data-testid="stHeader"] {
                display: flex !important;
                visibility: visible !important;
                background: rgba(250, 250, 249, 0.95) !important;
                backdrop-filter: blur(8px) !important;
                border-bottom: 1px solid #e7e5e4 !important;
                z-index: 1000000 !important;
                height: 3.25rem !important;
            }
            
            div[data-testid="stToolbar"], 
            div[data-testid="stAppDeployButton"], 
            .stAppDeployButton,
            button[data-testid="stAppDeployButton"] {
                display: flex !important;
                visibility: visible !important;
                opacity: 1 !important;
                z-index: 1000001 !important;
            }

            /* Sidebar styling */
            section[data-testid="stSidebar"] {
                z-index: 1000002 !important;
                background: #fdfcfb !important;
                border-right: 1px solid #e7e5e4 !important;
            }

            div[data-testid="collapsedControl"] {
                z-index: 1000003 !important;
                top: 0.5rem !important;
                left: 0.75rem !important;
            }

            /* Hide bottom footer */
            footer { display: none !important; }

            /* Clean full-width main container */
            .block-container {
                padding-top: 3.5rem !important;
                padding-bottom: 0 !important;
                padding-left: 0 !important;
                padding-right: 0 !important;
                max-width: 100% !important;
            }

            /* Custom component wrapper and iframe fill width and height cleanly */
            div[data-testid="stCustomComponentV1"] {
                width: 100% !important;
            }
            div[data-testid="stCustomComponentV1"] iframe {
                width: 100% !important;
                height: 92vh !important;
                border: none !important;
            }
        </style>
        """,
        unsafe_allow_html=True,
    )

    # ── Sidebar Native Scraper & Model Runner ───────────────────────────
    with st.sidebar:
        st.markdown("## ⚡ Live Review Scraper")
        st.caption(
            "Scrape customer reviews from Flipkart & Snapdeal and train **LDA vs NMF** models live."
        )

        col_p1, col_p2 = st.columns(2)
        with col_p1:
            if st.button("📋 Saved Links", key="sb_btn_saved", use_container_width=True):
                st.session_state["sb_u1"] = "https://www.flipkart.com/apple-iphone-15-black-128-gb/p/itm6ac6485515ae4?pid=MOBGTAGPTB3VS24W"
                st.session_state["sb_u2"] = "https://www.snapdeal.com/product/life-like-a10-pro-in/661262075466"
                st.rerun()
        with col_p2:
            if st.button("🔄 Clear", key="sb_btn_clear", use_container_width=True):
                st.session_state["sb_u1"] = ""
                st.session_state["sb_u2"] = ""
                st.rerun()

        if "sb_u1" not in st.session_state:
            st.session_state["sb_u1"] = "https://www.flipkart.com/apple-iphone-15-black-128-gb/p/itm6ac6485515ae4?pid=MOBGTAGPTB3VS24W"
        if "sb_u2" not in st.session_state:
            st.session_state["sb_u2"] = "https://www.snapdeal.com/product/life-like-a10-pro-in/661262075466"

        u1 = st.text_input("Product URL 1 (Flipkart)", key="sb_u1")
        u2 = st.text_input("Product URL 2 (Snapdeal)", key="sb_u2")

        c_k, c_p = st.columns(2)
        with c_k:
            sb_n_topics = st.slider("Topics (k)", min_value=2, max_value=8, value=3, key="sb_slider_k")
        with c_p:
            sb_max_pages = st.slider("Pages", min_value=1, max_value=3, value=1, key="sb_slider_p")

        run_sb = st.button("🚀 Scrape & Train Models", key="sb_btn_run", type="primary", use_container_width=True)

        if run_sb:
            sb_urls = [u.strip() for u in [u1, u2] if u and u.strip()]
            if len(sb_urls) < 2:
                st.error("Please enter at least 2 product URLs.")
            else:
                with st.status("Running Scraper & Model Pipeline...", expanded=True) as status_box:
                    try:
                        st.write("🕷️ Scraping reviews from e-commerce sites...")
                        from ml.scraper import scrape_reviews
                        df_scraped = scrape_reviews(sb_urls, max_pages=sb_max_pages)
                        st.write(f"✅ Scraped {len(df_scraped)} reviews from {df_scraped['source'].nunique()} site(s).")
                        
                        csv_path = os.path.join(UPLOADS_DIR, "scraped_reviews.csv")
                        df_scraped.to_csv(csv_path, index=False)
                        
                        st.write("⚙️ Preprocessing text & building matrices...")
                        st.write("🧠 Training LDA & NMF topic models...")
                        from ml.pipeline import _run_pipeline_worker, _set_is_custom
                        _set_is_custom(True)
                        _run_pipeline_worker(
                            n_topics=sb_n_topics,
                            sample_size=None,
                            data_path=csv_path,
                            is_custom=True,
                        )
                        status_box.update(label="🎉 Pipeline Complete! Reloading dashboard...", state="complete")
                        st.success("Models trained successfully! Updating dashboard...")
                        st.cache_data.clear()
                        st.rerun()
                    except Exception as err:
                        status_box.update(label="Scraping/Pipeline Failed", state="error")
                        st.error(f"Error: {err}")

    compiled_html = get_compiled_html()
    components.html(compiled_html, height=1000, scrolling=True)


if __name__ == "__main__":
    main()

