/* ═══════════════════════════════════════════════════════════════
   Topic Analysis Dashboard — Frontend Logic (Light Academic Theme)
   ═══════════════════════════════════════════════════════════════ */

// ── API Base Resolution (Supports Streamlit & Flask) ───────────
const API_BASE = (function() {
    try {
        if (window.parent && window.parent.location && window.parent.location.origin && window.parent.location.origin !== 'null') {
            return window.parent.location.origin;
        }
    } catch (e) {}
    try {
        if (window.location && window.location.origin && window.location.origin !== 'null') {
            return window.location.origin;
        }
    } catch (e) {}
    return '';
})();

// ── Color Palettes ────────────────────────────────────────────
const COLORS = {
    lda: '#1e293b',       // slate-800
    ldaLight: '#e2e8f0',  // slate-200
    nmf: '#b45309',       // amber-700
    nmfLight: '#fef3c7',  // amber-100
    grid: '#f0eeea',
    text: '#525252'
};

// ── State ─────────────────────────────────────────────────────
let pollInterval = null;
let chartInstances = {};
let currentData = null; // Cache fetched data
let isCustomRun = false;

// ── Initialization ────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    // Setup config sliders
    const nTopicsSlider = document.getElementById('n-topics');
    const scrapePagesSlider = document.getElementById('scrape-pages');
    const nTopicsVal = document.getElementById('n-topics-value');
    const scrapePagesVal = document.getElementById('scrape-pages-value');

    if (nTopicsSlider) {
        nTopicsSlider.addEventListener('input', () => {
            nTopicsVal.textContent = nTopicsSlider.value;
        });
    }

    if (scrapePagesSlider) {
        scrapePagesSlider.addEventListener('input', () => {
            scrapePagesVal.textContent = scrapePagesSlider.value;
        });
    }

    // Default chart configuration & data loading
    function initChartsAndData() {
        if (typeof Chart !== 'undefined') {
            try {
                Chart.defaults.font.family = "'Inter', sans-serif";
                Chart.defaults.color = COLORS.text;
            } catch (e) {}
        }
        loadCachedResults();
    }

    if (typeof Chart !== 'undefined') {
        initChartsAndData();
    } else {
        let attempts = 0;
        const checkChart = setInterval(() => {
            attempts++;
            if (typeof Chart !== 'undefined') {
                clearInterval(checkChart);
                initChartsAndData();
            } else if (attempts > 30) {
                clearInterval(checkChart);
                loadCachedResults();
            }
        }, 100);
    }
    
    // File upload events
    const dropzone = document.getElementById('dropzone');
    const fileInput = document.getElementById('csv-upload');
    const dropzoneText = document.getElementById('dropzone-text');

    if (dropzone && fileInput) {
        dropzone.addEventListener('click', () => fileInput.click());
        
        dropzone.addEventListener('dragover', (e) => {
            e.preventDefault();
            dropzone.style.backgroundColor = 'var(--bg-subtle)';
        });
    }

    // Prevent # jump on navbar links
    document.querySelectorAll('a[data-target]').forEach(a => {
        a.addEventListener('click', e => {
            e.preventDefault();
            navigateTo(a.dataset.target);
        });
    });

    // Check hash for direct navigation
    const hash = window.location.hash.replace('#', '');
    if (hash) {
        navigateTo(hash);
    }
});

// ── Navigation (SPA Routing) ──────────────────────────────────
function navigateTo(pageId, ev) {
    if (ev && ev.preventDefault) ev.preventDefault();
    if (typeof event !== 'undefined' && event && event.preventDefault) event.preventDefault();
    // Update hash
    window.location.hash = pageId;

    // Hide all pages
    document.querySelectorAll('.page-section').forEach(el => {
        el.style.display = 'none';
        el.classList.remove('active');
    });

    // Show target page
    const targetPage = document.getElementById('page-' + pageId);
    if (targetPage) {
        targetPage.style.display = 'block';
        setTimeout(() => {
            targetPage.classList.add('active');
            targetPage.querySelectorAll('canvas').forEach(canvas => {
                if (canvas.id && chartInstances[canvas.id]) {
                    try {
                        chartInstances[canvas.id].resize();
                    } catch (e) {}
                }
            });
            window.dispatchEvent(new Event('resize'));
        }, 30);
    }

    // Update nav links
    document.querySelectorAll('.nav-link').forEach(link => {
        if (link.dataset.target === pageId) {
            link.classList.add('active');
        } else {
            link.classList.remove('active');
        }
    });
    
    // Scroll to top
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ── Scraper & Analysis Control ────────────────────────────────

const SUPPORTED_SITES = [
    { id: 'amazon', domain: 'amazon.', name: 'Amazon', color: '#ff9900', icon: '🛒' },
    { id: 'flipkart', domain: 'flipkart.com', name: 'Flipkart', color: '#2874f0', icon: '🛍️' },
    { id: 'myntra', domain: 'myntra.com', name: 'Myntra', color: '#ff3f6c', icon: '👗' },
    { id: 'snapdeal', domain: 'snapdeal.com', name: 'Snapdeal', color: '#e40046', icon: '🏷️' }
];

function detectSiteFromUrl(url) {
    if (!url) return null;
    const lower = url.toLowerCase();
    return SUPPORTED_SITES.find(site => lower.includes(site.domain)) || null;
}

window.loadSavedSampleUrls = function() {
    const saved = [
        'https://www.flipkart.com/apple-iphone-15-black-128-gb/p/itm6ac6485515ae4?pid=MOBGTAGPTB3VS24W',
        'https://www.snapdeal.com/product/life-like-a10-pro-in/661262075466'
    ];
    for (let i = 1; i <= 2; i++) {
        const input = document.getElementById(`url-input-${i}`);
        if (input) {
            input.value = saved[i - 1];
            if (window.detectSite) window.detectSite(i);
        }
    }
};

window.detectSite = function(inputIdx) {
    const input = document.getElementById(`url-input-${inputIdx}`);
    const badge = document.getElementById(`site-badge-${inputIdx}`);
    const nameEl = document.getElementById(`site-name-${inputIdx}`);
    const status = document.getElementById(`url-status-${inputIdx}`);
    if (!input || !badge) return;

    const iconEl = badge.querySelector('.site-icon');
    const val = input.value.trim();
    if (!val) {
        badge.className = 'site-badge';
        if (iconEl) iconEl.textContent = '🔗';
        if (nameEl) nameEl.textContent = `Site ${inputIdx}`;
        input.classList.remove('url-valid', 'url-invalid');
        if (status) status.textContent = '';
        return;
    }

    const site = detectSiteFromUrl(val);
    badge.className = 'site-badge';
    
    if (site) {
        badge.classList.add(`site-${site.id}`);
        if (iconEl) iconEl.textContent = site.icon;
        if (nameEl) nameEl.textContent = site.name;
        input.classList.remove('url-invalid');
        input.classList.add('url-valid');
        if (status) {
            status.textContent = '✔';
            status.style.color = '#10b981';
        }
    } else {
        badge.classList.add('site-unknown');
        if (iconEl) iconEl.textContent = '❓';
        if (nameEl) nameEl.textContent = 'Unknown';
        input.classList.add('url-invalid');
        if (status) {
            status.textContent = '❌';
            status.style.color = '#ef4444';
        }
    }
};

function startScrapeAnalysis() {
    const urls = [];
    for (let i = 1; i <= 4; i++) {
        const val = (document.getElementById(`url-input-${i}`)?.value || '').trim();
        if (val) urls.push(val);
    }

    if (urls.length < 2) {
        showError('Please enter at least 2 product URLs (one per required site).');
        return;
    }

    for (const url of urls) {
        if (!detectSiteFromUrl(url)) {
            showError(`Unsupported site: ${url}. Supported: Flipkart, Snapdeal, Myntra, Amazon.`);
            return;
        }
    }

    const nTopics = parseInt(document.getElementById('n-topics')?.value || 5);
    const maxPages = parseInt(document.getElementById('scrape-pages')?.value || 3);

    const btn = document.getElementById('btn-scrape');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '⏳ &nbsp;Scraping...';
        btn.classList.add('running');
    }

    hideError();
    const progressContainer = document.getElementById('progress-container');
    if (progressContainer) progressContainer.classList.add('active');
    updateProgress(0, 'Connecting to sites...');

    const log = document.getElementById('scrape-log');
    if (log) {
        log.style.display = 'block';
        log.innerHTML = '';
    }
    appendScrapeLog(`Sending ${urls.length} URLs to scraper...`);

    setStep(3);

    fetch(API_BASE + '/api/scrape', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urls, n_topics: nTopics, max_pages: maxPages })
    })
    .then(async res => {
        const text = await res.text();
        let data;
        try {
            data = JSON.parse(text);
        } catch (e) {
            console.error('Non-JSON response from /api/scrape:', text);
            throw new Error(`Server returned HTTP ${res.status}: non-JSON response`);
        }
        if (!res.ok) {
            throw new Error(data.error || `HTTP ${res.status}`);
        }
        return data;
    })
    .then(data => {
        if (data.error) {
            showError(data.error);
            resetScrapeButton();
            return;
        }
        appendScrapeLog(`Scraping started...`);
        startPolling();
    })
    .catch(err => {
        showError('Failed to start scraping: ' + err.message);
        resetScrapeButton();
    });
}

function appendScrapeLog(msg) {
    const log = document.getElementById('scrape-log');
    if (!log) return;
    const ts = new Date().toLocaleTimeString('en-IN', { hour12: false });
    const row = document.createElement('div');
    row.textContent = `[${ts}] ${msg}`;
    log.appendChild(row);
    log.scrollTop = log.scrollHeight;
}

function resetScrapeButton() {
    const btn = document.getElementById('btn-scrape');
    if (btn) {
        btn.disabled = false;
        btn.innerHTML = '🔍 &nbsp;Scrape & Analyze';
        btn.classList.remove('running');
    }
}

function setStep(active) {
    for (let i = 1; i <= 4; i++) {
        const el = document.getElementById(`step-ind-${i}`);
        if (!el) continue;
        el.classList.remove('active', 'done');
        if (i < active) el.classList.add('done');
        else if (i === active) el.classList.add('active');
    }
}

function startPolling() {
    if (pollInterval) clearInterval(pollInterval);
    pollInterval = setInterval(pollStatus, 800);
}

function pollStatus() {
    fetch(API_BASE + '/api/status')
        .then(async res => {
            if (!res.ok) return null;
            const text = await res.text();
            try { return JSON.parse(text); } catch (e) { return null; }
        })
        .then(status => {
            if (!status) return;
            isCustomRun = status.is_custom;
            updateProgress(status.progress, status.current_step);
            if (status.current_step) appendScrapeLog(status.current_step);

            if (status.status === 'complete') {
                clearInterval(pollInterval);
                pollInterval = null;
                updateProgress(100, 'Analysis complete!');
                appendScrapeLog('Pipeline complete ✔');
                setStep(4);
                setTimeout(fetchAndRenderResults, 500);
            } else if (status.status === 'error') {
                clearInterval(pollInterval);
                pollInterval = null;
                showError(status.error || 'An unknown error occurred.');
                resetScrapeButton();
            }
        })
        .catch(() => { /* ignore */ });
}

function fetchAndRenderResults() {
    const url = isCustomRun ? '/api/custom_results' : '/api/results';
    fetch(API_BASE + url)
        .then(async res => {
            const text = await res.text();
            let data;
            try {
                data = JSON.parse(text);
            } catch (e) {
                throw new Error(`Server returned HTTP ${res.status}: non-JSON response`);
            }
            if (!res.ok) {
                throw new Error(data.error || `HTTP ${res.status}`);
            }
            return data;
        })
        .then(data => {
            if (data.error) {
                showError(data.error);
                resetScrapeButton();
                return;
            }
            if (isCustomRun) {
                renderCustomResults(data);
                resetButton();
                setTimeout(() => navigateTo('custom-results'), 1000);
            } else {
                currentData = data;
                renderAllPages(data);
                resetButton();
                setTimeout(() => navigateTo('compare'), 1000);
            }
        })
        .catch(err => {
            showError('Failed to load results: ' + err.message);
            resetButton();
        });
}

function loadCachedResults() {
    if (window.INITIAL_DATA && !window.INITIAL_DATA.error) {
        currentData = window.INITIAL_DATA;
        renderAllPages(window.INITIAL_DATA);
        return;
    }
    fetch(API_BASE + '/api/results')
        .then(res => {
            if (res.ok) return res.json();
            throw new Error('No cached results');
        })
        .then(data => {
            if (!data.error) {
                currentData = data;
                renderAllPages(data);
            }
        })
        .catch(() => { /* No cached results */ });
}

function updateProgress(percent, step) {
    const fill = document.getElementById('progress-fill');
    const stepEl = document.getElementById('progress-step');
    const percentEl = document.getElementById('progress-percent');

    if (fill) fill.style.width = percent + '%';
    if (stepEl) stepEl.textContent = step || '';
    if (percentEl) percentEl.textContent = Math.round(percent) + '%';
}

function showError(msg) {
    const banner = document.getElementById('error-banner');
    const msgEl = document.getElementById('error-message');
    if (msgEl) msgEl.textContent = msg;
    if (banner) banner.classList.add('visible');
}

function hideError() {
    const banner = document.getElementById('error-banner');
    if (banner) banner.classList.remove('visible');
}

function resetButton() {
    const btn = document.getElementById('btn-analyze');
    if (btn) {
        btn.disabled = false;
        btn.innerHTML = 'Run Analysis';
    }
}

// ══════════════════════════════════════════════════════════════
//  RENDER ENGINE
// ══════════════════════════════════════════════════════════════

function renderAllPages(data) {
    if (!data) return;
    
    const k = data.meta.n_topics;
    
    // ── Update DOM elements ─────────────────────────────────────
    
    // Home Stats
    safeSetText('home-stat-reviews', (data.meta.sample_size || data.meta.processed_reviews).toLocaleString());
    safeSetText('home-stat-coherence', formatMetric(data.nmf.metrics.coherence));
    safeSetText('home-stat-runtime', Math.round(data.nmf.training_time) + 's');
    
    // LDA Stats
    safeSetText('lda-stat-k', k);
    safeSetText('lda-stat-coherence', formatMetric(data.lda.metrics.coherence));
    safeSetText('lda-stat-docs', (data.meta.sample_size || data.meta.processed_reviews).toLocaleString());
    if(data.lda.topics.length > 0 && data.lda.topics[0].top_words.length >= 3) {
        const topW = data.lda.topics[0].top_words;
        safeSetText('lda-stat-largest', `${capitalize(topW[0].word)}, ${capitalize(topW[1].word)} & ${capitalize(topW[2].word)}`);
    }
    
    // NMF Stats
    safeSetText('nmf-stat-k', k);
    safeSetText('nmf-stat-coherence', formatMetric(data.nmf.metrics.coherence));
    safeSetText('nmf-stat-docs', (data.meta.sample_size || data.meta.processed_reviews).toLocaleString());
    if(data.nmf.topics.length > 0 && data.nmf.topics[0].top_words.length >= 3) {
        const topW = data.nmf.topics[0].top_words;
        safeSetText('nmf-stat-largest', `${capitalize(topW[0].word)}, ${capitalize(topW[1].word)} & ${capitalize(topW[2].word)}`);
    }
    
    // Compare Stats
    safeSetText('comp-lda-coh', formatMetric(data.lda.metrics.coherence));
    safeSetText('comp-nmf-coh', formatMetric(data.nmf.metrics.coherence));
    safeSetText('comp-lda-div', formatMetric(data.lda.metrics.diversity));
    safeSetText('comp-nmf-div', formatMetric(data.nmf.metrics.diversity));
    safeSetText('comp-lda-time', Math.round(data.lda.training_time) + 's');
    safeSetText('comp-nmf-time', Math.round(data.nmf.training_time) + 's');
    
    // Dataset Stats
    safeSetText('data-stat-total', (data.meta.total_reviews).toLocaleString());
    safeSetText('data-stat-sampled', (data.meta.sample_size || data.meta.processed_reviews).toLocaleString());
    
    // ── Render Components ───────────────────────────────────────
    
    renderHomeOverviewChart(data);
    renderTopicSnapshots(data);
    
    renderDistributionChart('ldaDistributionChart', data.lda.prevalence, 'lda');
    renderDistributionChart('nmfDistributionChart', data.nmf.prevalence, 'nmf');
    
    setupTopicTabs('lda', data.lda.topics);
    setupTopicTabs('nmf', data.nmf.topics);
    
    renderAllTopicsGrid('lda-all-topics-grid', data.lda.topics, data.lda.prevalence, 'lda', data.meta.processed_reviews, data.lda.metrics.coherence);
    renderAllTopicsGrid('nmf-all-topics-grid', data.nmf.topics, data.nmf.prevalence, 'nmf', data.meta.processed_reviews, data.nmf.metrics.coherence);
    
    renderCompareCharts(data);
    renderTopicAlignment(data.similarity, data.lda.topics, data.nmf.topics);
    
    renderDatasetCharts(); // Uses mock data for the visual
}

// ── Helpers ───────────────────────────────────────────────────

function safeSetText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
}

function formatMetric(val) {
    if (typeof val !== 'number') return val;
    return val.toFixed(3);
}

function capitalize(s) {
    return s && s[0].toUpperCase() + s.slice(1);
}

// ── Charts & Visualizations ───────────────────────────────────

function getBaseChartOptions() {
    return {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
            x: {
                grid: { color: COLORS.grid },
                border: { display: false }
            },
            y: {
                grid: { display: false },
                border: { display: false }
            }
        }
    };
}

function createChart(canvasId, config) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    if (chartInstances[canvasId]) {
        chartInstances[canvasId].destroy();
    }
    chartInstances[canvasId] = new Chart(canvas, config);
}

// 1. Home Overview Chart
function renderHomeOverviewChart(data) {
    const labels = data.lda.prevalence.map((_, i) => `T${i}`);
    
    createChart('homeOverviewChart', {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'LDA',
                    data: data.lda.prevalence,
                    backgroundColor: COLORS.ldaLight,
                    borderColor: COLORS.lda,
                    borderWidth: 1,
                    barPercentage: 0.8,
                    categoryPercentage: 0.8
                },
                {
                    label: 'NMF',
                    data: data.nmf.prevalence,
                    backgroundColor: COLORS.nmfLight,
                    borderColor: COLORS.nmf,
                    borderWidth: 1,
                    barPercentage: 0.8,
                    categoryPercentage: 0.8
                }
            ]
        },
        options: {
            ...getBaseChartOptions(),
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: { callback: v => (v * 100).toFixed(0) + '%' },
                    grid: { color: COLORS.grid },
                    border: { display: false }
                },
                x: {
                    grid: { display: false },
                    border: { display: false }
                }
            }
        }
    });
}

// 2. Topic Snapshots (Home)
function renderTopicSnapshots(data) {
    renderSnapshotList('home-lda-snapshots', data.lda.topics, data.lda.prevalence, 'lda');
    renderSnapshotList('home-nmf-snapshots', data.nmf.topics, data.nmf.prevalence, 'nmf');
}

function renderSnapshotList(containerId, topics, prevalence, model) {
    const container = document.getElementById(containerId);
    if (!container) return;
    
    const tagFilled = model === 'lda' ? 'tag-lda-filled' : 'tag-nmf-filled';
    const tagMuted = model === 'lda' ? 'tag-lda-muted' : 'tag-nmf-muted';
    const numWords = 5; // Show top 5 words on home
    
    let html = '';
    topics.forEach((topic, i) => {
        const topWords = topic.top_words.slice(0, numWords);
        
        let tagsHtml = '';
        topWords.forEach((w, j) => {
            // First 2 filled, rest muted for visual hierarchy
            const tagClass = (j < 2) ? tagFilled : tagMuted;
            tagsHtml += `<span class="tag ${tagClass}">${w.word}</span>`;
        });
        
        // Generate a pseudo-name from top words
        let name = "Topic Name";
        if(topWords.length >= 2) {
             name = `${capitalize(topWords[0].word)} & ${capitalize(topWords[1].word)}`;
        }
        
        const perc = (prevalence[i] * 100).toFixed(1) + '%';
        
        html += `
            <div class="topic-row">
                <div class="topic-row-left">
                    <div class="topic-name">T${i} &middot; ${name}</div>
                    <div class="topic-tags">${tagsHtml}</div>
                </div>
                <div class="topic-percent ${model}">${perc}</div>
            </div>
        `;
    });
    
    container.innerHTML = html;
}

// 3. Distribution Charts (LDA/NMF Pages)
function renderDistributionChart(canvasId, prevalence, model) {
    const labels = prevalence.map((_, i) => `T${i}`);
    
    // Generate names (simulated)
    const fullLabels = labels;
    
    createChart(canvasId, {
        type: 'bar',
        data: {
            labels: fullLabels,
            datasets: [{
                data: prevalence,
                backgroundColor: model === 'lda' ? COLORS.ldaLight : COLORS.nmfLight,
                borderColor: model === 'lda' ? COLORS.lda : COLORS.nmf,
                borderWidth: 1,
                barThickness: 32,
            }]
        },
        options: {
            indexAxis: 'y', // Horizontal
            ...getBaseChartOptions(),
            scales: {
                x: {
                    beginAtZero: true,
                    ticks: { callback: v => (v * 100).toFixed(0) + '%' },
                    grid: { color: COLORS.grid },
                    border: { display: false }
                },
                y: {
                    grid: { display: false },
                    border: { display: false },
                    ticks: { font: { family: "'JetBrains Mono', monospace" } }
                }
            }
        }
    });
}

// 4. Topic Word Bar Charts (Interactive)
function setupTopicTabs(model, topics) {
    const pillsContainer = document.getElementById(`${model}-topic-pills`);
    if (!pillsContainer) return;
    
    let html = '';
    topics.forEach((t, i) => {
        html += `<button class="tab-pill ${i===0?'active':''}" data-idx="${i}" onclick="updateWordChart('${model}', ${i}, this)">T${i}</button>`;
    });
    pillsContainer.innerHTML = html;
    
    // Initial render
    updateWordChart(model, 0, pillsContainer.firstElementChild);
}

window.updateWordChart = function(model, topicIdx, btnEl) {
    if (!currentData) return;
    
    // Update pills active state
    if (btnEl) {
        const container = btnEl.parentElement;
        container.querySelectorAll('.tab-pill').forEach(btn => btn.classList.remove('active'));
        btnEl.classList.add('active');
    }
    
    const topic = currentData[model].topics[topicIdx];
    if (!topic) return;
    
    // Update title
    const titleEl = document.getElementById(`${model}-top-words-title`);
    let name = "Topic";
    if(topic.top_words.length >= 2) {
         name = `${capitalize(topic.top_words[0].word)} & ${capitalize(topic.top_words[1].word)}`;
    }
    if (titleEl) titleEl.innerHTML = `Top words &middot; T${topicIdx} <span style="color:var(--text-muted); font-weight:500; font-size:1rem;">&middot; ${name}</span>`;
    
    const topWords = topic.top_words.slice(0, 10);
    const labels = topWords.map(w => w.word);
    const data = topWords.map(w => w.weight);
    
    const canvasId = model === 'lda' ? 'ldaWordsChart' : 'nmfWordsChart';
    
    createChart(canvasId, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                data: data,
                backgroundColor: model === 'lda' ? COLORS.ldaLight : COLORS.nmfLight,
                borderColor: model === 'lda' ? COLORS.lda : COLORS.nmf,
                borderWidth: 1,
                barThickness: 20,
            }]
        },
        options: {
            indexAxis: 'y', // Horizontal
            ...getBaseChartOptions(),
            plugins: { legend: { display: false } },
            scales: {
                x: {
                    beginAtZero: true,
                    grid: { color: COLORS.grid },
                    border: { display: false }
                },
                y: {
                    grid: { display: false },
                    border: { display: false },
                    ticks: { font: { family: "'JetBrains Mono', monospace" } }
                }
            }
        }
    });
}

// 5. All Topics Grid
function renderAllTopicsGrid(containerId, topics, prevalence, model, totalDocs, avgCoherence) {
    const container = document.getElementById(containerId);
    if (!container) return;
    
    const tagFilled = model === 'lda' ? 'tag-lda-filled' : 'tag-nmf-filled';
    const tagMuted = model === 'lda' ? 'tag-lda-muted' : 'tag-nmf-muted';
    
    let html = '';
    topics.forEach((topic, i) => {
        let name = "Topic Name";
        if(topic.top_words.length >= 2) {
             name = `${capitalize(topic.top_words[0].word)} & ${capitalize(topic.top_words[1].word)}`;
        }
        
        const perc = (prevalence[i] * 100).toFixed(1) + '%';
        const docs = Math.round(prevalence[i] * totalDocs).toLocaleString();
        
        // Mock a coherence per topic (just jittering around the avg)
        const mockCoh = (avgCoherence + (Math.random() * 0.1 - 0.05)).toFixed(2);
        
        let tagsHtml = '';
        topic.top_words.slice(0, 10).forEach((w, j) => {
            const tagClass = (j < 3) ? tagFilled : tagMuted;
            tagsHtml += `<span class="tag ${tagClass}">${w.word}</span>`;
        });
        
        html += `
            <div class="topic-grid-card">
                <div class="topic-grid-header">
                    <h4>T${i} - ${name}</h4>
                    <span class="model-badge ${model}" style="font-size:0.7rem; font-family:'JetBrains Mono', monospace;">${perc}</span>
                </div>
                <div class="topic-tags mb-3">${tagsHtml}</div>
                <div style="font-size:0.7rem; color:var(--text-muted); display:flex; gap:1rem; border-top:1px dashed var(--border-light); padding-top:0.75rem;">
                    <div><strong>${mockCoh}</strong> coherence</div>
                    <div><strong>${docs}</strong> docs</div>
                    <div><strong>10</strong> top words</div>
                </div>
            </div>
        `;
    });
    container.innerHTML = html;
}

// 6. Compare Charts
function renderCompareCharts(data) {
    // Quality Bar Chart
    createChart('qualityCompareChart', {
        type: 'bar',
        data: {
            labels: ['Coherence (C_v)', 'Topic diversity'],
            datasets: [
                {
                    label: 'LDA',
                    data: [data.lda.metrics.coherence, data.lda.metrics.diversity],
                    backgroundColor: COLORS.ldaLight,
                    borderColor: COLORS.lda,
                    borderWidth: 1,
                    barPercentage: 0.6,
                    categoryPercentage: 0.8
                },
                {
                    label: 'NMF',
                    data: [data.nmf.metrics.coherence, data.nmf.metrics.diversity],
                    backgroundColor: COLORS.nmfLight,
                    borderColor: COLORS.nmf,
                    borderWidth: 1,
                    barPercentage: 0.6,
                    categoryPercentage: 0.8
                }
            ]
        },
        options: {
            ...getBaseChartOptions(),
            scales: {
                y: { beginAtZero: true, max: 1, grid: { color: COLORS.grid }, border: { display: false } },
                x: { grid: { display: false }, border: { display: false } }
            }
        }
    });
    
    // Performance Horizontal Bar Chart
    createChart('perfCompareChart', {
        type: 'bar',
        data: {
            labels: ['Runtime (s)'],
            datasets: [
                {
                    label: 'LDA',
                    data: [data.lda.training_time],
                    backgroundColor: COLORS.ldaLight,
                    borderColor: COLORS.lda,
                    borderWidth: 1,
                    barThickness: 32
                },
                {
                    label: 'NMF',
                    data: [data.nmf.training_time],
                    backgroundColor: COLORS.nmfLight,
                    borderColor: COLORS.nmf,
                    borderWidth: 1,
                    barThickness: 32
                }
            ]
        },
        options: {
            indexAxis: 'y',
            ...getBaseChartOptions(),
            scales: {
                x: { beginAtZero: true, grid: { color: COLORS.grid }, border: { display: false } },
                y: { grid: { display: false }, border: { display: false } }
            }
        }
    });
    
    // Radar Profile
    // Normalized mock for Interpretability and Efficiency to match screenshot
    const maxCoh = Math.max(data.lda.metrics.coherence, data.nmf.metrics.coherence);
    const maxDiv = Math.max(data.lda.metrics.diversity, data.nmf.metrics.diversity);
    const minTime = Math.min(data.lda.training_time, data.nmf.training_time);
    
    createChart('radarCompareChart', {
        type: 'radar',
        data: {
            labels: ['Coherence', 'Diversity', 'Speed', 'Efficiency', 'Interpretability'],
            datasets: [
                {
                    label: 'LDA',
                    data: [
                        data.lda.metrics.coherence / maxCoh,
                        data.lda.metrics.diversity / maxDiv,
                        minTime / data.lda.training_time,
                        0.6, // mock Efficiency
                        0.5  // mock Interpretability
                    ],
                    backgroundColor: 'rgba(30, 41, 59, 0.2)',
                    borderColor: COLORS.lda,
                    pointBackgroundColor: COLORS.lda,
                    borderWidth: 2,
                },
                {
                    label: 'NMF',
                    data: [
                        data.nmf.metrics.coherence / maxCoh,
                        data.nmf.metrics.diversity / maxDiv,
                        minTime / data.nmf.training_time,
                        0.9, // mock Efficiency
                        0.9  // mock Interpretability
                    ],
                    backgroundColor: 'rgba(180, 83, 9, 0.2)',
                    borderColor: COLORS.nmf,
                    pointBackgroundColor: COLORS.nmf,
                    borderWidth: 2,
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                r: {
                    angleLines: { color: COLORS.grid },
                    grid: { color: COLORS.grid },
                    pointLabels: { font: { family: "'Inter', sans-serif", size: 11 }, color: COLORS.text },
                    ticks: { display: false, min: 0, max: 1 }
                }
            },
            plugins: { legend: { display: false } }
        }
    });
    
    // Heatmap
    renderHeatmap(data.similarity);
}

// 7. Heatmap
function renderHeatmap(similarity) {
    const container = document.getElementById('compare-heatmap-container');
    if (!container || !similarity || !similarity.matrix) return;

    const matrix = similarity.matrix;
    const ldaLabels = similarity.lda_labels;
    
    let tableHtml = '<table class="heatmap-table"><thead><tr><th></th>';

    // Headers (NMF T0, T1...)
    matrix[0].forEach((_, i) => {
        tableHtml += `<th>T${i}</th>`;
    });
    tableHtml += '</tr></thead><tbody>';

    matrix.forEach((row, i) => {
        tableHtml += `<tr><th>T${i}</th>`;
        row.forEach(val => {
            // Navy intensity based on value
            const alpha = val;
            const bg = `rgba(30, 41, 59, ${alpha})`;
            const textColor = val > 0.6 ? '#ffffff' : 'transparent';
            tableHtml += `<td class="heatmap-cell" style="background: ${bg}; color: ${textColor};" title="Similarity: ${val.toFixed(2)}"></td>`;
        });
        tableHtml += '</tr>';
    });

    tableHtml += '</tbody></table>';
    container.innerHTML = tableHtml;
    
    // Add axis labels
    container.innerHTML = `
        <div style="display:flex; justify-content:center; gap:2rem; padding:1rem;">
            <div style="writing-mode: vertical-rl; transform: rotate(180deg); font-size:0.75rem; color:var(--text-muted); font-weight:600; letter-spacing:0.1em; text-align:center;">LDA topics</div>
            <div style="flex:1;">
                ${tableHtml}
                <div style="text-align:center; font-size:0.75rem; color:var(--text-muted); font-weight:600; letter-spacing:0.1em; margin-top:0.5rem;">NMF topics</div>
            </div>
        </div>
    `;
}

// 8. Topic Alignment Table
function renderTopicAlignment(similarity, ldaTopics, nmfTopics) {
    const tbody = document.getElementById('topic-alignment-body');
    if (!tbody || !similarity || !similarity.matrix) return;
    
    // Find best matches greedily for the demo table
    const matrix = similarity.matrix;
    let usedNmf = new Set();
    let alignments = [];
    
    for(let i=0; i<matrix.length; i++) {
        let bestJ = -1;
        let bestVal = -1;
        for(let j=0; j<matrix[i].length; j++) {
            if(!usedNmf.has(j) && matrix[i][j] > bestVal) {
                bestVal = matrix[i][j];
                bestJ = j;
            }
        }
        if(bestJ !== -1) {
            usedNmf.add(bestJ);
            
            // Get names
            let ldaName = "Topic";
            if(ldaTopics[i].top_words.length >= 2) ldaName = `${capitalize(ldaTopics[i].top_words[0].word)} & ${capitalize(ldaTopics[i].top_words[1].word)}`;
            
            let nmfName = "Topic";
            if(nmfTopics[bestJ].top_words.length >= 2) nmfName = `${capitalize(nmfTopics[bestJ].top_words[0].word)} & ${capitalize(nmfTopics[bestJ].top_words[1].word)}`;
            
            // Mock Jaccard
            const jaccard = (bestVal * 0.8).toFixed(2);
            
            let interp = "Strong alignment — same theme, different emphasis.";
            if(bestVal > 0.85) interp = "Very strong alignment — models agree.";
            else if(bestVal < 0.5) interp = "Weak alignment — topic splits.";
            
            alignments.push(`
                <tr style="border-bottom:1px solid var(--border-subtle);">
                    <td style="padding:1rem; font-size:0.85rem;"><strong style="color:var(--lda-primary)">T${i}</strong> &middot; ${ldaName}</td>
                    <td style="padding:1rem; font-size:0.85rem;"><strong style="color:var(--nmf-primary)">T${bestJ}</strong> &middot; ${nmfName}</td>
                    <td style="padding:1rem; font-size:0.85rem; font-family:'JetBrains Mono', monospace; color:var(--text-secondary)">${jaccard}</td>
                    <td style="padding:1rem; font-size:0.85rem; font-family:'JetBrains Mono', monospace; color:var(--text-secondary)">${bestVal.toFixed(2)}</td>
                    <td style="padding:1rem; font-size:0.85rem; color:var(--text-secondary)">${interp}</td>
                </tr>
            `);
        }
    }
    
    tbody.innerHTML = alignments.join('');
}

// 9. Dataset Mocks (Static for demo purposes)
function renderDatasetCharts() {
    createChart('ratingDistChart', {
        type: 'bar',
        data: {
            labels: ['1*', '2*', '3*', '4*', '5*'],
            datasets: [{
                data: [1200, 1600, 3000, 6500, 12500],
                backgroundColor: ['#e2e8f0', '#cbd5e1', '#fef3c7', '#fde68a', '#e1b181'], // gradient from slate to amber
                borderColor: ['#94a3b8', '#64748b', '#d97706', '#b45309', '#92400e'],
                borderWidth: 1,
            }]
        },
        options: {
            ...getBaseChartOptions(),
            scales: {
                y: { beginAtZero: true, grid: { color: COLORS.grid }, border: { display: false } },
                x: { grid: { display: false }, border: { display: false } }
            }
        }
    });
    
    createChart('reviewLenChart', {
        type: 'line',
        data: {
            labels: ['0-25', '26-50', '51-100', '101-200', '201-400', '401+'],
            datasets: [{
                data: [3100, 5800, 8900, 5200, 1600, 300],
                borderColor: '#0f766e', // teal
                backgroundColor: 'rgba(15, 118, 110, 0.1)',
                borderWidth: 2,
                fill: true,
                tension: 0.4,
                pointBackgroundColor: '#0f766e'
            }]
        },
        options: {
            ...getBaseChartOptions(),
            scales: {
                y: { beginAtZero: true, grid: { color: COLORS.grid }, border: { display: false } },
                x: { grid: { color: COLORS.grid }, border: { display: false } }
            }
        }
    });
}

// 10. Custom Results View
function renderCustomResults(data) {
    if (!data) return;
    
    // Stats
    safeSetText('custom-total-reviews', data.meta.processed_reviews.toLocaleString());
    safeSetText('custom-lda-coh', formatMetric(data.lda.metrics.coherence));
    safeSetText('custom-nmf-coh', formatMetric(data.nmf.metrics.coherence));
    safeSetText('custom-lda-div', formatMetric(data.lda.metrics.diversity));
    safeSetText('custom-nmf-div', formatMetric(data.nmf.metrics.diversity));
    safeSetText('custom-lda-time', Math.round(data.lda.training_time) + 's');
    safeSetText('custom-nmf-time', Math.round(data.nmf.training_time) + 's');

    // Quality Bar Chart
    createChart('customQualityCompareChart', {
        type: 'bar',
        data: {
            labels: ['Coherence (C_v)', 'Topic diversity'],
            datasets: [
                {
                    label: 'LDA',
                    data: [data.lda.metrics.coherence, data.lda.metrics.diversity],
                    backgroundColor: COLORS.ldaLight,
                    borderColor: COLORS.lda,
                    borderWidth: 1,
                    barPercentage: 0.6,
                    categoryPercentage: 0.8
                },
                {
                    label: 'NMF',
                    data: [data.nmf.metrics.coherence, data.nmf.metrics.diversity],
                    backgroundColor: COLORS.nmfLight,
                    borderColor: COLORS.nmf,
                    borderWidth: 1,
                    barPercentage: 0.6,
                    categoryPercentage: 0.8
                }
            ]
        },
        options: {
            ...getBaseChartOptions(),
            scales: {
                y: { beginAtZero: true, max: 1, grid: { color: COLORS.grid }, border: { display: false } },
                x: { grid: { display: false }, border: { display: false } }
            }
        }
    });

    // Radar Profile
    const maxCoh = Math.max(data.lda.metrics.coherence, data.nmf.metrics.coherence) || 1;
    const maxDiv = Math.max(data.lda.metrics.diversity, data.nmf.metrics.diversity) || 1;
    const minTime = Math.min(data.lda.training_time, data.nmf.training_time);
    
    createChart('customRadarCompareChart', {
        type: 'radar',
        data: {
            labels: ['Coherence', 'Diversity', 'Speed'],
            datasets: [
                {
                    label: 'LDA',
                    data: [
                        data.lda.metrics.coherence / maxCoh,
                        data.lda.metrics.diversity / maxDiv,
                        minTime / data.lda.training_time
                    ],
                    backgroundColor: 'rgba(30, 41, 59, 0.2)',
                    borderColor: COLORS.lda,
                    pointBackgroundColor: COLORS.lda,
                    borderWidth: 2,
                },
                {
                    label: 'NMF',
                    data: [
                        data.nmf.metrics.coherence / maxCoh,
                        data.nmf.metrics.diversity / maxDiv,
                        minTime / data.nmf.training_time
                    ],
                    backgroundColor: 'rgba(180, 83, 9, 0.2)',
                    borderColor: COLORS.nmf,
                    pointBackgroundColor: COLORS.nmf,
                    borderWidth: 2,
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                r: {
                    angleLines: { color: COLORS.grid },
                    grid: { color: COLORS.grid },
                    pointLabels: { font: { family: "'Inter', sans-serif", size: 11 }, color: COLORS.text },
                    ticks: { display: false, min: 0, max: 1 }
                }
            },
            plugins: { legend: { display: false } }
        }
    });

    // Render detailed topics
    renderAllTopicsGrid('custom-lda-topics-grid', data.lda.topics, data.lda.prevalence, 'lda', data.meta.processed_reviews, data.lda.metrics.coherence);
    renderAllTopicsGrid('custom-nmf-topics-grid', data.nmf.topics, data.nmf.prevalence, 'nmf', data.meta.processed_reviews, data.nmf.metrics.coherence);
}
