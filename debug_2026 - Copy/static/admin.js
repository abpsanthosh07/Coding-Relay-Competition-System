let cachedData = {
    teams: null,
    challenges: null,
    status: null
};

// Map to store challenge objects by ID -- avoids JSON.stringify() in onclick attributes
const challengeRegistry = {};

function switchTab(event, tab) {
    try {
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));

        const targetTab = document.getElementById(tab + 'Tab');
        if (targetTab) {
            targetTab.classList.add('active');
        } else {
            console.error(`Tab ${tab}Tab not found`);
        }

        if (event && event.currentTarget) {
            event.currentTarget.classList.add('active');
        }

        if (tab === 'user') loadTeams(false);
        if (tab === 'exam') loadChallenges(false);
        if (tab === 'leader') loadAdminStatus(false);
        if (tab === 'globalLeader') loadAdminLeaderboardFullData();
    } catch (e) {
        console.error("Error switching tab:", e);
    }
}

// --- LEADERBOARD CONTROL ---
async function loadAdminStatus(force = true) {
    try {
        if (!force && cachedData.status) {
            renderAdminStatus(cachedData.status);
            return;
        }
        const res = await fetch('/admin/api/status');
        if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
        cachedData.status = await res.json();
        renderAdminStatus(cachedData.status);
    } catch (e) {
        console.error("Error loading admin status:", e);
    }
}

function renderAdminStatus(data) {
    if (!data || !data.leaderboard) return;
    const display = document.getElementById('leaderStatusDisplay');
    if (display) {
        display.innerText = data.leaderboard.toUpperCase();
        display.style.color = data.leaderboard === 'On' ? '#00ff41' : '#ff3e3e';
    }
}

async function updateLeaderboard(status) {
    try {
        const res = await fetch('/admin/api/update-leaderboard', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: status })
        });
        if (res.ok) {
            loadAdminStatus(true);
            showSystemAlert("Leaderboard status updated to: " + status, "SECURITY_OVERRIDE");
        }
    } catch (e) {
        console.error("Error updating leaderboard:", e);
        showSystemAlert("Failed to update leaderboard status.", "SYSTEM_ERR");
    }
}

// --- USER MANAGEMENT ---
async function loadTeams(force = true) {
    try {
        if (!force && cachedData.teams) {
            renderTeams(cachedData.teams);
            return;
        }
        const res = await fetch('/admin/api/teams');
        if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
        const data = await res.json();
        if (Array.isArray(data)) {
            cachedData.teams = data;
            renderTeams(data);
        } else {
            console.error("Teams data is not an array:", data);
        }
    } catch (e) {
        console.error("Error loading teams:", e);
    }
}

function renderTeams(teams) {
    try {
        const tbody = document.getElementById('teamsTableBody');
        if (!tbody) {
            console.error("teamsTableBody not found");
            return;
        }
        tbody.innerHTML = '';
        if (!teams || !Array.isArray(teams)) return;

        teams.forEach(team => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><input type="text" value="${team.team_name || ''}" id="tn-${team.id}"></td>
                <td><input type="text" value="${team.email || ''}" id="em-${team.id}"></td>
                <td>
                    <select id="col-${team.id}">
                        <option value="" ${!team.color ? 'selected' : ''}>Unassigned</option>
                        <option value="Red" ${team.color === 'Red' ? 'selected' : ''}>Red</option>
                        <option value="Green" ${team.color === 'Green' ? 'selected' : ''}>Green</option>
                        <option value="Blue" ${team.color === 'Blue' ? 'selected' : ''}>Blue</option>
                    </select>
                </td>
                <td>
                    <select id="st-${team.id}">
                        <option value="Registered" ${team.status === 'Registered' ? 'selected' : ''}>Registered</option>
                        <option value="Active" ${team.status === 'Active' ? 'selected' : ''}>Active</option>
                        <option value="DQ" ${team.status === 'DQ' ? 'selected' : ''}>DQ'd</option>
                    </select>
                </td>
                <td>
                    <button onclick="updateTeam('${team.id}')">SAVE</button>
                    <button class="btn-danger" onclick="deleteTeam('${team.id}')">DEL</button>
                </td>
            `;
            tbody.appendChild(tr);
        });
    } catch (e) {
        console.error("Error rendering teams:", e);
    }
}

async function updateTeam(id) {
    try {
        const data = {
            id: id,
            team_name: document.getElementById('tn-' + id).value,
            email: document.getElementById('em-' + id).value,
            color: document.getElementById('col-' + id).value,
            status: document.getElementById('st-' + id).value
        };
        const res = await fetch('/admin/api/update-team', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        if (res.ok) {
            await loadTeams(true);
            showSystemAlert("Team data updated successfully.", "PROTOCOL_SYNC");
        } else {
            showSystemAlert("Failed to update team.", "AUTH_SYS_ERR");
        }
    } catch (e) {
        console.error("Error updating team:", e);
        alert("An error occurred while updating the team.");
    }
}

async function deleteTeam(id) {
    try {
        if (!confirm("Confirm termination of this team?")) return;
        const res = await fetch('/admin/api/delete-team', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: id })
        });
        if (res.ok) {
            loadTeams(true);
        } else {
            alert("Failed to delete team.");
        }
    } catch (e) {
        console.error("Error deleting team:", e);
        alert("An error occurred while deleting the team.");
    }
}

// --- EXAM MANAGEMENT ---
function addTestCase(input = '', output = '') {
    try {
        const container = document.getElementById('testCasesContainer');
        if (!container) return;
        const div = document.createElement('div');
        div.className = 'test-case-row';
        div.innerHTML = `
                <textarea placeholder="Input" class="tc-input">${input}</textarea>
                <textarea placeholder="Output" class="tc-output">${output}</textarea>
                <button class="btn-danger" onclick="this.parentElement.remove()" style="padding: 2px 8px;">X</button>
            `;
        container.appendChild(div);
    } catch (e) {
        console.error("Error adding test case:", e);
    }
}

async function saveChallenge() {
    try {
        const test_cases = [];
        document.querySelectorAll('.test-case-row').forEach(row => {
            const i = row.querySelector('.tc-input').value;
            const o = row.querySelector('.tc-output').value;
            if (i || o) test_cases.push({ input: i, output: o });
        });

        const idField = document.getElementById('challengeId');
        const data = {
            challenge_id: idField ? idField.value : '',
            round: document.getElementById('roundSelect').value,
            color: document.getElementById('colorSelect').value,
            title: document.getElementById('challengeTitle').value,
            desc: document.getElementById('challengeDesc').value,
            c_code: document.getElementById('cCode').value,
            py_code: document.getElementById('pyCode').value,
            java_code: document.getElementById('javaCode').value,
            key: document.getElementById('unlockKey').value,
            difficulty: document.getElementById('difficulty').value,
            duration: document.getElementById('duration').value,
            test_cases: test_cases
        };

        const res = await fetch('/admin/set-challenge', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        const result = await res.json();
        if (res.ok) {
            showSystemAlert(result.message, "DEPLOYMENT_SYNC");
            loadChallenges(true);
            resetChallengeForm();
        } else {
            showSystemAlert("Failed to deploy challenge: " + (result.message || "Unknown error"), "UPLINK_ERR");
        }
    } catch (e) {
        console.error("Error saving challenge:", e);
        alert("An error occurred while saving the challenge.");
    }
}

function resetChallengeForm() {
    try {
        const idField = document.getElementById('challengeId');
        if (idField) idField.value = '';

        const fields = ['challengeTitle', 'challengeDesc', 'cCode', 'pyCode', 'javaCode', 'unlockKey'];
        fields.forEach(f => {
            const el = document.getElementById(f);
            if (el) el.value = '';
        });
        const diff = document.getElementById('difficulty');
        if (diff) diff.value = 'easy';

        const container = document.getElementById('testCasesContainer');
        if (container) {
            container.innerHTML = `
                <div class="test-case-row">
                    <textarea placeholder="Input" class="tc-input"></textarea>
                    <textarea placeholder="Output" class="tc-output"></textarea>
                </div>
            `;
        }
    } catch (e) {
        console.error("Error resetting form:", e);
    }
}

async function loadChallenges(force = true) {
    try {
        if (!force && cachedData.challenges) {
            renderChallenges(cachedData.challenges);
            return;
        }
        const res = await fetch('/admin/api/challenges');
        if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
        cachedData.challenges = await res.json();
        renderChallenges(cachedData.challenges);
    } catch (e) {
        console.error("Error loading challenges:", e);
    }
}

function renderChallenges(data) {
    try {
        const list = document.getElementById('challengesList');
        if (!list) return;
        list.innerHTML = '';

        for (const round in data) {
            const rDiv = document.createElement('div');
            rDiv.style.marginBottom = '15px';
            rDiv.innerHTML = `<h3 style="color: #00ff41; margin-bottom: 5px;">${round}</h3>`;

            if (data[round].length === 0) {
                rDiv.innerHTML += `<p style="color: #666; font-size: 0.8rem;">[NO_DATA_AVAILABLE]</p>`;
            } else {
                const table = document.createElement('table');
                table.innerHTML = `
                        <thead>
                            <tr>
                                <th>COLOR</th>
                                <th>TITLE</th>
                                <th>DIFFICULTY</th>
                                <th>KEY</th>
                                <th>ACTIONS</th>
                            </tr>
                        </thead>
                        <tbody></tbody>
                    `;
                const tbody = table.querySelector('tbody');

                const difficultyOrder = { 'easy': 1, 'medium': 2, 'hard': 3 };
                data[round].sort((a, b) => {
                    const diffA = difficultyOrder[a.difficulty] || 99;
                    const diffB = difficultyOrder[b.difficulty] || 99;
                    return diffA - diffB;
                });

                data[round].forEach(c => {
                    // Store challenge in registry so onclick can reference by ID safely
                    challengeRegistry[c.id] = { data: c, round: round };

                    const tr = document.createElement('tr');
                    tr.innerHTML = `
                            <td>${c.color || c.id}</td>
                            <td>${c.title || ''}</td>
                            <td>${c.difficulty || 'easy'}</td>
                            <td><code>${c.unlock_key || ''}</code></td>
                            <td>
                                <button onclick="editChallengeById('${c.id}')">EDIT</button>
                                <button class="btn-danger" onclick="deleteChallenge('${round}', '${c.id}')">DEL</button>
                            </td>
                        `;
                    tbody.appendChild(tr);
                });
                rDiv.appendChild(table);
            }
            list.appendChild(rDiv);
        }
    } catch (e) {
        console.error("Error rendering challenges:", e);
    }
}

async function deleteChallenge(round, id) {
    try {
        if (!confirm("Purge this challenge data?")) return;
        const res = await fetch('/admin/api/delete-challenge', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ round: round, id: id })
        });
        if (res.ok) loadChallenges(true);
    } catch (e) {
        console.error("Error deleting challenge:", e);
    }
}

/**
 * Safe edit: looks up the challenge from the registry by ID instead of
 * relying on inline JSON (which breaks when code snippets contain quotes).
 */
function editChallengeById(id) {
    try {
        const entry = challengeRegistry[id];
        if (!entry) {
            console.error('Challenge not found in registry:', id);
            showSystemAlert('Could not load challenge data. Try refreshing.', 'REGISTRY_ERR');
            return;
        }
        editChallenge(entry.data, entry.round);
    } catch (e) {
        console.error('Error in editChallengeById:', e);
    }
}

function editChallenge(c, round) {
    try {
        const idField = document.getElementById('challengeId');
        if (idField) idField.value = c.id;

        document.getElementById('roundSelect').value = round;
        document.getElementById('colorSelect').value = c.color || c.id;
        document.getElementById('challengeTitle').value = c.title || '';
        document.getElementById('challengeDesc').value = c.description || '';
        document.getElementById('cCode').value = c.c_code || '';
        document.getElementById('pyCode').value = c.python_code || '';
        document.getElementById('javaCode').value = c.java_code || '';
        document.getElementById('unlockKey').value = c.unlock_key || '';
        document.getElementById('difficulty').value = c.difficulty || 'easy';
        document.getElementById('duration').value = c.duration || 1800;

        const container = document.getElementById('testCasesContainer');
        if (container) {
            container.innerHTML = '';
            if (c.test_cases && c.test_cases.length > 0) {
                c.test_cases.forEach(tc => addTestCase(tc.input, tc.output));
            } else {
                addTestCase();
            }
        }

        // Switch to exam tab and scroll to form
        const examNavBtn = Array.from(document.querySelectorAll('.nav-btn')).find(b => b.textContent.trim() === 'EXAM_MANAGEMENT');
        switchTab({ currentTarget: examNavBtn || null }, 'exam');
        const form = document.getElementById('challengeForm');
        if (form) form.scrollIntoView({ behavior: 'smooth' });
    } catch (e) {
        console.error("Error editing challenge:", e);
    }
}

// Initial load
window.onload = async () => {
    try {
        await loadChallenges(true);
        await loadTeams(true);
        await loadAdminStatus(true);
        await loadAdminLeaderboard();
        setInterval(loadAdminLeaderboard, 5000); // Pulse top student every 5 sec
    } catch (e) {
        console.error("Error in window.onload:", e);
    }
};

// --- TOP TEAM LEADERBOARD BANNER ---
async function loadAdminLeaderboard() {
    try {
        const res = await fetch('/api/leaderboard');
        const data = await res.json();

        const banner = document.getElementById('adminTopRunner');
        const textTarget = document.getElementById('topTeamData');

        if (!banner || !textTarget) return;

        if (data.length > 0 && data[0].score > 0) {
            banner.style.display = 'block';
            const top = data[0];
            textTarget.innerHTML = `<span style="color:#00ff41;">${top.team_name}</span> - <span style="color:#fff;">${top.score} PTS</span> <span style="font-size:0.9rem; color:#888;">(R1: ${top.r1_prog}/3 | R2: ${top.r2_solved ? 'SOLVED' : 'PENDING'})</span>`;
        } else {
            banner.style.display = 'none'; // Hide if no one has points
        }
    } catch (e) {
        console.error("Error loading top team banner:", e);
    }
}

// --- FULL ADMIN LEADERBOARD VIEW ---
let currentLeaderFilter = 'Overall';
let currentSectorFilter = 'All';

function setLeaderboardFilter(filter) {
    currentLeaderFilter = filter;
    document.getElementById('btnFilterOverall').style.borderBottom = filter === 'Overall' ? '2px solid #00ff41' : 'none';
    document.getElementById('btnFilterR1').style.borderBottom = filter === 'Round1' ? '2px solid #00ff41' : 'none';
    document.getElementById('btnFilterR2').style.borderBottom = filter === 'Round2' ? '2px solid #00ff41' : 'none';
    loadAdminLeaderboardFullData();
}

function setSectorFilter(val) {
    currentSectorFilter = val;
    loadAdminLeaderboardFullData();
}

async function loadAdminLeaderboardFullData() {
    const leaderAlert = document.getElementById('adminGlobalLeaderAlert');
    if (!leaderAlert) return;

    try {
        const response = await fetch(`/api/leaderboard?round=${currentLeaderFilter}`);
        let data = await response.json();

        if (!data || data.length === 0) {
            leaderAlert.innerHTML = "No teams active yet.";
            return;
        }

        // Apply Sector Filter
        if (currentSectorFilter !== 'All') {
            data = data.filter(t => t.color === currentSectorFilter);
        }

        let html = `
            <table style="width: 100%; text-align: left; border-collapse: collapse; margin-top: 20px;">
                <thead>
                    <tr style="border-bottom: 2px solid #00ff41; color: #00ff41;">
                        <th style="padding: 10px;">RANK</th>
                        <th style="padding: 10px;">TEAM NAME</th>
                        <th style="padding: 10px;">SECTOR</th>
                        ${currentLeaderFilter === 'Round1' ? '<th style="padding: 10px;">R1_PROGRESS (E/M/H)</th>' : ''}
                        <th style="padding: 10px;">SCORE</th>
                    </tr>
                </thead>
                <tbody>
        `;

        data.forEach((team, index) => {
            let rankColor = "#aaa";
            let rankStr = `${index + 1}`;
            if (index === 0) { rankColor = "#ffdf00"; rankStr = "🏆 1"; }
            else if (index === 1) { rankColor = "#c0c0c0"; rankStr = "🥈 2"; }
            else if (index === 2) { rankColor = "#cd7f32"; rankStr = "🥉 3"; }

            const sectorColor = (team.color || 'white').toLowerCase();
            const sectorBadge = `<span style="border: 1px solid ${sectorColor}; color: ${sectorColor}; padding: 2px 6px; border-radius: 3px; font-size: 0.75rem; background: rgba(0,0,0,0.3); font-weight: bold;">${team.color ? team.color.toUpperCase() : 'NONE'}</span>`;

            let progressHtml = '';
            if (currentLeaderFilter === 'Round1') {
                const prog = team.r1_prog || 0;
                progressHtml = `<td style="padding: 10px; font-family: monospace;">
                    <span style="color: ${prog > 0 ? '#00ff41' : '#444'};">[E]</span>
                    <span style="color: ${prog > 1 ? '#00ff41' : '#444'};">[M]</span>
                    <span style="color: ${prog > 2 ? '#00ff41' : '#444'};">[H]</span>
                </td>`;
            }

            html += `
                <tr style="border-bottom: 1px solid #333; color: ${rankColor}; font-weight: ${index < 3 ? 'bold' : 'normal'}">
                    <td style="padding: 10px;">${rankStr}</td>
                    <td style="padding: 10px; color: #fff;">${team.team_name}</td>
                    <td style="padding: 10px;">${sectorBadge}</td>
                    ${progressHtml}
                    <td style="padding: 10px; color: #00ff41; font-weight: bold;">${team.score} PTS</td>
                </tr>
            `;
        });

        html += `</tbody></table>`;
        leaderAlert.innerHTML = html;

    } catch (e) {
        leaderAlert.innerHTML = "<span style='color: #ff3e3e;'>Error linking to leaderboard server.</span>";
        console.error("Error loading full leaderboard data:", e);
    }
}

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