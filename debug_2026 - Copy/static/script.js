let currentChallengeData = null;
let popupShownThisPhase = false;
let modalTimer = null;
let lastKnownPhase = "Stop";
// Navigation buttons are now simple <a> links in the templates.

/**
 * HEARTBEAT FUNCTION
 * Runs every 3 seconds to check if Admin has started/stopped the round.
 */
async function checkPhase() {
    try {
        const response = await fetch('/check-phase');
        const data = await response.json();

        // If Admin flips from STOP to an active Round, immediately kill the popup.
        if (lastKnownPhase === "Stop" && data.phase !== "Stop") {
            forceCloseModal();
            popupShownThisPhase = false;
        }

        lastKnownPhase = data.phase;

        // Leaderboard visibility toggle removed.

        if (data.phase === 'Stop') {
            if (!popupShownThisPhase && !window.location.pathname.includes('/leaderboard')) {
                showModal();
            }
            document.getElementById('qrKey').disabled = true;
            document.getElementById('unlockBtn').disabled = true;
            document.getElementById('roundIndicator').innerText = "🔴 STATUS: SESSION FROZEN BY ADMIN";
            document.getElementById('roundIndicator').style.color = "#ff3e3e";
        } else {
            // Session is Active: Enable UI and reset popup trigger for next stop
            forceCloseModal();
            popupShownThisPhase = false;
            document.getElementById('qrKey').disabled = false;
            document.getElementById('unlockBtn').disabled = false;
            document.getElementById('roundIndicator').innerText = "🟢 ACTIVE: " + data.phase;
            document.getElementById('roundIndicator').style.color = "#00ff41";
        }
    } catch (e) {
        // Silently fail or log to console. user requested removal of "OFFLINE: CHECK NETWORK"
        console.warn("Heartbeat connection lost.");
    }
}

/**
 * MODAL POPUP LOGIC
 */
function showModal() {
    const modal = document.getElementById('stopModal');
    modal.classList.remove('hidden');
    popupShownThisPhase = true;

    let timeLeft = 10;
    document.getElementById('seconds').innerText = timeLeft;

    if (modalTimer) clearInterval(modalTimer);

    modalTimer = setInterval(() => {
        timeLeft--;
        const timerSpan = document.getElementById('seconds');
        if (timerSpan) timerSpan.innerText = timeLeft;

        if (timeLeft <= 0) {
            forceCloseModal();
        }
    }, 1000);
}

/**
 * FORCE CLOSE MODAL
 * Completely hides the popup and kills the background timer.
 */
function forceCloseModal() {
    const modal = document.getElementById('stopModal');
    modal.classList.add('hidden');
    if (modalTimer) {
        clearInterval(modalTimer);
        modalTimer = null;
    }
}

// Manual 'X' button or Dismiss button
function closeModal() { forceCloseModal(); }

/**
 * CHALLENGE RETRIEVAL - Shows overview panel
 */
async function unlockChallenge() {
    const keyInput = document.getElementById('qrKey').value.trim();
    if (!keyInput) {
        showSystemAlert("SYSTEM ERROR: QR Secret Required.", "INPUT_ERROR");
        return;
    }

    const response = await fetch('/api/challenge-overview?key=' + encodeURIComponent(keyInput));

    if (response.status === 403) {
        const errorData = await response.json();
        showSystemAlert("ACCESS DENIED: " + errorData.message, "GUARD_RESTRICTION");
        return;
    }

    const data = await response.json();

    if (data.success) {
        // Store key for later when a challenge card is clicked
        window._activeQRKey = keyInput;
        renderChallengeCards(data.challenges);
    } else {
        showSystemAlert(data.message || "Invalid Key.", "ACCESS_DENIED");
    }
}

/**
 * Renders challenge cards with lock/unlock/completed status
 */
function renderChallengeCards(challenges) {
    const overview = document.getElementById('challengeOverview');
    const cards = document.getElementById('challengeCards');

    // Make sure we clear the cards container
    cards.innerHTML = '';

    const icons = { easy: '⚡', medium: '⚙️', hard: '💀' };

    challenges.forEach(c => {
        const card = document.createElement('div');
        card.className = 'challenge-card ' + c.status;

        const badgeClass = c.status === 'unlocked' ? 'badge-unlocked' :
            c.status === 'completed' ? 'badge-completed' : 'badge-locked';
        const badgeText = c.status === 'unlocked' ? '▶ START' :
            c.status === 'completed' ? '✓ DONE' : '🔒 LOCKED';
        const diffClass = 'diff-' + c.difficulty;

        card.innerHTML = `
            <div class="card-diff-icon">${icons[c.difficulty] || '❓'}</div>
            <div class="card-diff-label ${diffClass}">${c.difficulty.toUpperCase()}</div>
            <div class="card-title">${c.title}</div>
            <div class="card-status-badge ${badgeClass}">${badgeText}</div>
        `;

        if (c.status === 'unlocked') {
            card.onclick = () => openChallenge(c.id);
        }

        cards.appendChild(card);
    });

    overview.classList.remove('hidden');
}

/**
 * Navigates to the dedicated challenge page by its ID.
 */
function openChallenge(challengeId) {
    if (!challengeId) return;
    window.location.href = '/challenge/' + encodeURIComponent(challengeId);
}

// Initialization & Heartbeat logic continues below.

// Initialize Heartbeat
setInterval(checkPhase, 3000);

// Initial check on load
window.onload = () => {
    checkPhase();
    if (window.location.pathname === '/leaderboard') {
        loadLeaderboardUser();
        setInterval(loadLeaderboardUser, 5000); // Auto-refresh leaderboard
    }
};

/**
 * USER LEADERBOARD FETCHING
 */
async function loadLeaderboardUser() {
    const leaderAlert = document.getElementById('leaderAlert');
    if (!leaderAlert) return;

    try {
        const response = await fetch('/api/leaderboard?round=Overall');
        const data = await response.json();

        if (data.length === 0) {
            leaderAlert.innerHTML = "No teams active yet.";
            return;
        }

        let html = `
            <table style="width: 100%; text-align: left; border-collapse: collapse; margin-top: 20px;">
                <thead>
                    <tr style="border-bottom: 2px solid #00ff41; color: #00ff41;">
                        <th style="padding: 10px;">RANK</th>
                        <th style="padding: 10px;">TEAM NAME</th>
                        <th style="padding: 10px;">DEPT</th>
                        <th style="padding: 10px;">SCORE</th>
                    </tr>
                </thead>
                <tbody>
        `;

        data.forEach((team, index) => {
            // Highlight top 3
            let color = "#aaa";
            let rankStr = `${index + 1}`;
            if (index === 0) { color = "#ffdf00"; rankStr = "🏆 1"; } // Gold
            else if (index === 1) { color = "#c0c0c0"; rankStr = "🥈 2"; } // Silver
            else if (index === 2) { color = "#cd7f32"; rankStr = "🥉 3"; } // Bronze

            html += `
                <tr style="border-bottom: 1px solid #333; color: ${color}; font-weight: ${index < 3 ? 'bold' : 'normal'}">
                    <td style="padding: 10px;">${rankStr}</td>
                    <td style="padding: 10px;">${team.team_name}</td>
                    <td style="padding: 10px;">${team.department || '-'}</td>
                    <td style="padding: 10px;">${team.score} PTS</td>
                </tr>
            `;
        });

        html += `</tbody></table>`;
        leaderAlert.innerHTML = html;

    } catch (e) {
        leaderAlert.innerHTML = "<span style='color: #ff3e3e;'>Error linking to leaderboard server.</span>";
    }
}

/**
 * INITIALIZATION & PERSISTENCE RESTORATION
 */
function initDashboard() {
    // Start heartbeat
    setInterval(checkPhase, 3000);
    checkPhase();

    // Check if we are on the leaderboard page
    if (document.getElementById('leaderAlert')) {
        loadLeaderboardUser();
        setInterval(loadLeaderboardUser, 10000); // refresh every 10s
    }

    // Only process activeChallenge restore if we actually stayed on the relay page
    if (window.location.pathname.includes('/relay')) {
        const savedChallengeId = localStorage.getItem('activeChallengeId');
        if (savedChallengeId) {
            // Optional: immediately redirect if they left accidentally
            // But usually it's better to let them decide to re-open via the card
            console.log("Session has active challenge logic disabled since it's on a separate page.");
        }
    }
}

// Global initialization
window.onload = initDashboard;

/**
 * CUSTOM ALERT SYSTEM
 */
function showSystemAlert(msg, title = "SYSTEM_MESSAGE") {
    const modal = document.getElementById('systemAlert');
    const titleEl = document.getElementById('alertTitle');
    const bodyEl = document.getElementById('alertBody');

    if (modal && titleEl && bodyEl) {
        titleEl.innerText = "> " + title;
        bodyEl.innerText = msg;
        modal.classList.remove('hidden');
    } else {
        alert(msg); // Fallback
    }
}

function closeSystemAlert() {
    const modal = document.getElementById('systemAlert');
    if (modal) modal.classList.add('hidden');
}

function logoutUser() {
    // We can't easily replace confirm() without a lot of complexity, so we'll leave it for now
    // but we can replace basic alerts.
    if (confirm("Terminate secure uplink and log out?")) {
        localStorage.removeItem('activeChallenge');
        window.location.href = '/logout';
    }
}