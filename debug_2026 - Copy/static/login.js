async function checkPhase() {
    try {
        const response = await fetch('/check-phase');
        const data = await response.json();

        if (data.phase === 'Stop') {
            document.getElementById('stopModal').classList.remove('hidden');
            document.getElementById('mainEntry').style.opacity = "0.2";
            // Optionally disable inputs
            document.querySelectorAll('input, button').forEach(el => el.disabled = true);
        } else {
            document.getElementById('stopModal').classList.add('hidden');
            document.getElementById('mainEntry').style.opacity = "1";
            document.querySelectorAll('input, button').forEach(el => el.disabled = false);
            document.getElementById('logonStatus').innerText = "ONLINE (" + data.phase + ")";
            document.getElementById('logonStatus').style.color = "#00ff41";
        }
    } catch (e) {
        console.error("Heartbeat error", e);
    }
}

// Initialize Heartbeat
setInterval(checkPhase, 3000);
window.onload = checkPhase;

function showSection(section) {
    if (section === 'login') {
        document.getElementById('loginSection').style.display = 'block';
        document.getElementById('registerSection').style.display = 'none';
    } else {
        document.getElementById('loginSection').style.display = 'none';
        document.getElementById('registerSection').style.display = 'block';
    }
}

function addMemberField() {
    const container = document.getElementById('membersContainer');
    const newGroup = document.createElement('div');
    newGroup.className = 'member-input-group';
    newGroup.innerHTML = `
        <input type="text" class="operative-name" placeholder="Agent Name" required>
        <button type="button" class="remove-member-btn" onclick="removeMemberField(this)">×</button>
    `;
    container.appendChild(newGroup);
}

function removeMemberField(btn) {
    btn.parentElement.remove();
}

function prepareRegistration() {
    const inputs = document.querySelectorAll('.operative-name');
    const members = Array.from(inputs).map(i => i.value.trim()).filter(v => v !== "");

    if (members.length < 3) {
        showSystemAlert("Authorization Failed: All 3 operative identifiers are required.", "SECURITY_BREACH");
        return false;
    }

    document.getElementById('finalMembers').value = members.join(',');
    return true;
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
    document.getElementById('systemAlert').classList.add('hidden');
}