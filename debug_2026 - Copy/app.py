import firebase_admin
from firebase_admin import credentials, firestore, auth
import os
import subprocess
import uuid
import time
from concurrent.futures import ThreadPoolExecutor
from flask import Flask, render_template, request, redirect, jsonify, url_for, session, flash

app = Flask(__name__)
# Secret key is required to use 'session' for team login persistence
app.secret_key = "relay_mission_secret_key_2026"
app.config['SESSION_PERMANENT'] = True
from datetime import timedelta
app.config['PERMANENT_SESSION_LIFETIME'] = timedelta(days=7)

# 1. Initialize Firebase
# Ensure serviceAccountKey.json is in your project directory
cred = credentials.Certificate("serviceAccountKey.json")
firebase_admin.initialize_app(cred)
db = firestore.client()

# --- HELPER FUNCTIONS ---

def get_active_phase():
    """Helper to fetch the current phase status from Firestore"""
    settings_ref = db.collection('settings').document('phase_control').get()
    if settings_ref.exists:
        return settings_ref.to_dict().get('active_phase', 'Stop')
    return 'Stop'

def get_leaderboard_status():
    """Helper to fetch the current leaderboard status (On/Off)"""
    settings_ref = db.collection('settings').document('leaderboard_control').get()
    if settings_ref.exists:
        return settings_ref.to_dict().get('status', 'Off')
    return 'Off'

# --- GATEKEEPER & AUTH ROUTES ---

@app.route('/')
def entrance():
    """Gatekeeper: Checks if a round is active to force login/register"""
    # If already logged in, go straight to dashboard
    if 'team_id' in session:
        return redirect(url_for('dashboard'))
        
    # Always return the login/register template; 
    # the backend 'login' route below will handle the security if status is 'Stop'
    return render_template('login.html')

@app.route('/login', methods=['GET', 'POST'])
def login():
    """Checks credentials and initializes session, but only if NOT stopped"""
    if request.method == 'GET':
        return redirect(url_for('entrance'))

    # STRICT LOGIN GUARD: Prevent login if phase is STOPPED
    if get_active_phase() == 'Stop':
        return "ACCESS DENIED: The session is paused. Login is disabled. <a href='/'>Back</a>"

    email = request.form.get('email')
    password = request.form.get('password')
    teams_ref = db.collection('teams')
    query = teams_ref.where('email', '==', email).limit(1).stream()
    
    for doc in query:
        team_data = doc.to_dict()
        if team_data.get('password') == password:
            if team_data.get('status') == 'DQ':
                flash("Your team has been disqualified by the administrator.")
                return redirect(url_for('entrance'))
                
            session.clear() # Clear any stale data
            session['team_id'] = doc.id  # Store Firestore document ID in session
            session.permanent = True    # Persist session across browser reloads
            return redirect(url_for('dashboard'))
        else:
            flash("Invalid password.")
            return redirect(url_for('entrance'))
            
    flash("Invalid email or team not found.")
    return redirect(url_for('entrance'))

@app.route('/register', methods=['POST'])
def register():
    """Handles Team Registration but only if a Round is active"""
    if get_active_phase() == 'Stop':
        return "ACCESS DENIED: Registration is closed while the session is paused. <a href='/'>Back</a>"

    try:
        email = request.form.get('email')
        password = request.form.get('password')
        team_name = request.form.get('team_name')
        department = request.form.get('department')
        members_str = request.form.get('members', '')
        members_list = [m.strip() for m in members_str.split(',')] if members_str else []
        
        # 1. Create User in Firebase Auth
        user = auth.create_user(email=email, password=password)
        
        # 2. Store Team Info in Firestore
        db.collection('teams').document(user.uid).set({
            'team_name': team_name,
            'department': department,
            'members': members_list,
            'email': email,
            'password': password,  # Stored here due to Admin SDK limitations
            'status': 'Registered',
            'round1_progress': 0, # 0=easy, 1=medium, 2=hard
            'round2_solved': False
        })
        flash("Registration Successful! Please login.")
        return redirect(url_for('entrance'))
    except Exception as e:
        flash(f"Error: {str(e)}")
        return redirect(url_for('entrance'))

@app.route('/logout')
def logout():
    """Clears team session"""
    session.pop('team_id', None)
    return redirect(url_for('entrance'))

# --- ADMIN ROUTES ---

@app.route('/admin')
def admin_page():
    """Admin Panel: Controls Phase and Assigns Problems"""
    current_phase = get_active_phase()
    return render_template('admin.html', current_phase=current_phase)

@app.route('/admin/update-phase', methods=['POST'])
def update_phase():
    """Feature: Update session status (Round 1/2/3 or Stop)"""
    new_phase = request.form.get('phase')
    db.collection('settings').document('phase_control').set({'active_phase': new_phase})
    return redirect(url_for('admin_page'))

@app.route('/admin/api/status', methods=['GET'])
def get_admin_status():
    """Fetch both phase and leaderboard status"""
    return jsonify({
        'phase': get_active_phase(),
        'leaderboard': get_leaderboard_status()
    })

@app.route('/admin/api/update-leaderboard', methods=['POST'])
def update_leaderboard():
    """Toggle leaderboard visibility"""
    data = request.json
    new_status = data.get('status') # 'On' or 'Off'
    db.collection('settings').document('leaderboard_control').set({'status': new_status})
    return jsonify({'success': True})

# --- NEW ADMIN API ROUTES ---

@app.route('/admin/api/teams', methods=['GET'])
def get_teams():
    """Fetch all teams for admin management"""
    teams_ref = db.collection('teams').stream()
    teams = []
    for doc in teams_ref:
        team_data = doc.to_dict()
        team_data['id'] = doc.id
        teams.append(team_data)
    return jsonify(teams)

@app.route('/admin/api/update-team', methods=['POST'])
def update_team():
    """Edit team details"""
    data = request.json
    team_id = data.get('id')
    # Try to mirror email updates to Firebase Auth
    if data.get('email'):
        try:
            auth.update_user(team_id, email=data.get('email'))
        except Exception as e:
            print(f"Auth Update Warning: {e}")

    update_data = {
        'team_name': data.get('team_name'),
        'email': data.get('email'),
        'color': data.get('color'),
        'status': data.get('status')
    }
    db.collection('teams').document(team_id).update(update_data)
    return jsonify({'success': True})

@app.route('/admin/api/delete-team', methods=['POST'])
def delete_team():
    """Delete a team from Firestore and Firebase Authentication"""
    team_id = request.json.get('id')
    try:
        auth.delete_user(team_id)
    except Exception as e:
        print(f"Auth Deletion Warning: {e}")
    db.collection('teams').document(team_id).delete()
    return jsonify({'success': True})

@app.route('/admin/api/challenges', methods=['GET'])
def get_challenges():
    """Fetch all challenges organized by round"""
    rounds = ['Round 1', 'Round 2', 'Round 3']
    all_challenges = {}

    for r in rounds:
        challenges_ref = db.collection('rounds').document(r).collection('challenges').stream()
        all_challenges[r] = [dict(doc.to_dict(), id=doc.id) for doc in challenges_ref]

    return jsonify(all_challenges)

@app.route('/admin/api/delete-challenge', methods=['POST'])
def delete_challenge():
    """Delete a specific challenge"""
    round_no = request.json.get('round')
    challenge_id = request.json.get('id')
    db.collection('rounds').document(round_no).collection('challenges').document(challenge_id).delete()
    return jsonify({'success': True})

@app.route('/admin/set-challenge', methods=['POST'])
def handle_admin_submit():
    """Hierarchical Assignment: Round -> Color -> Code Data + Session Control"""
    data = request.json
    round_no = data.get('round')
    color = data.get('color')
    challenge_id = data.get('challenge_id')
    
    challenge_data = {
        'color': color,
        'title': data.get('title'),
        'description': data.get('desc'),
        'c_code': data.get('c_code'),
        'python_code': data.get('py_code'),
        'java_code': data.get('java_code'),
        'unlock_key': data.get('key'),
        'difficulty': data.get('difficulty', 'easy'), # For Round 1 linear progression
        'duration': data.get('duration'),           # In seconds
        'test_cases': data.get('test_cases')        # List of {input, output}
    }
    
    if challenge_id:
        db.collection('rounds').document(round_no).collection('challenges').document(challenge_id).set(challenge_data)
    else:
        new_id = str(uuid.uuid4())
        db.collection('rounds').document(round_no).collection('challenges').document(new_id).set(challenge_data)
        
    return jsonify({'success': True, 'message': f"Successfully deployed {color} challenge for {round_no}!"})

# --- TEAM DASHBOARD ROUTES ---

@app.route('/dashboard')
def dashboard():
    """Protected Dashboard: Access only for logged-in teams"""
    if 'team_id' not in session:
        return redirect(url_for('entrance'))
    return redirect(url_for('relay_page'))

@app.route('/relay')
def relay_page():
    if 'team_id' not in session:
        return redirect(url_for('entrance'))
        
    team_doc = db.collection('teams').document(session['team_id']).get()
    team_data = team_doc.to_dict() if team_doc.exists else {}
    
    return render_template('relay.html', team=team_data)

@app.route('/challenge/<challenge_id>')
def challenge_page(challenge_id):
    """Dedicated per-challenge page. The JS fetches challenge data via /api/get-challenge/<id>."""
    if 'team_id' not in session:
        return redirect(url_for('entrance'))
    return render_template('challenge.html')

@app.route('/leaderboard')
def leaderboard_page():
    if 'team_id' not in session:
        return redirect(url_for('entrance'))
    return render_template('leaderboard.html')

@app.route('/api/leaderboard', methods=['GET'])
def get_leaderboard():
    """Returns all teams sorted by their computed score for a specific round or overall"""
    round_filter = request.args.get('round', 'Overall')
    
    teams_ref = db.collection('teams').stream()
    leaderboard = []
    
    for doc in teams_ref:
        team_data = doc.to_dict()
        # DQ teams are no longer skipped in the ranking.
            
        r1_prog = int(team_data.get('round1_progress', 0))
        r2_solved = team_data.get('round2_solved', False)
        
        # Dynamic Grading Marks Logic
        score = 0
        testcase_scores = team_data.get('testcase_scores', {})
        total_testcase_score = sum(len(cases) * 10 for cases in testcase_scores.values() if isinstance(cases, list))
        
        # Legacy fallback if it was storing integers previously
        for k, v in testcase_scores.items():
            if isinstance(v, (int, float)):
                total_testcase_score += v
        
        if round_filter == 'Round1':
            score = total_testcase_score
        elif round_filter == 'Round2':
            score = 50 if r2_solved else 0
        else: # 'Overall'
            score += total_testcase_score
            if r2_solved:
                score += 50
            
        # Only add teams that have participated/scored if we are filtering, 
        # or just add everyone. Here we add everyone so they see their rank.
        leaderboard.append({
            'team_name': team_data.get('team_name', 'Unknown'),
            'department': team_data.get('department', 'N/A'),
            'score': score,
            'last_score_time': team_data.get('last_score_time', 0),
            'testcase_scores': testcase_scores # Include for admin drill-down
        })
        
    # Sort by score descending, then by last_score_time ascending (earlier is better)
    leaderboard.sort(key=lambda x: (-x['score'], x['last_score_time']))
    return jsonify(leaderboard)

@app.route('/check-phase')
def check_phase():
    """Heartbeat route: User dashboard checks this every few seconds"""
    team_status = 'Active'
    if 'team_id' in session:
        team_doc = db.collection('teams').document(session['team_id']).get()
        if team_doc.exists:
            team_status = team_doc.to_dict().get('status', 'Active')
        else:
            team_status = 'Deleted'
            
    return jsonify({
        'phase': get_active_phase(),
        'status': team_status,
        'leaderboard': get_leaderboard_status()
    })

@app.route('/api/challenge-overview', methods=['GET'])
def challenge_overview():
    """Returns all challenges for a team's color in the active round, with status metadata.
    Used to display the lock/unlock progress panel after QR key verification."""
    user_key = request.args.get('key', '')
    active_phase = get_active_phase()

    if active_phase == 'Stop':
        return jsonify({'success': False, 'message': 'SESSION PAUSED by Admin.'}), 403

    if 'team_id' not in session:
        return jsonify({'success': False, 'message': 'Not logged in.'}), 401

    team_doc = db.collection('teams').document(session['team_id']).get()
    team_data = team_doc.to_dict() or {}
    team_color = team_data.get('color')
    r1_prog = team_data.get('round1_progress', 0)

    if not team_color:
        return jsonify({'success': False, 'message': 'UNASSIGNED COLOR: Contact admin.'})

    # Validate the key belongs to this round (check at least one matching key exists for team color)
    diff_order = {'easy': 0, 'medium': 1, 'hard': 2}
    challenges_ref = db.collection('rounds').document(active_phase).collection('challenges')
    all_docs = challenges_ref.stream()

    team_challenges = []
    key_valid = False
    for doc in all_docs:
        cdata = doc.to_dict()
        cdata['id'] = doc.id
        if cdata.get('color') == team_color:
            team_challenges.append(cdata)
        if cdata.get('unlock_key') == user_key and cdata.get('color') == team_color:
            key_valid = True
            # [CRITICAL] Start timer for this specific challenge the moment the key is validly entered
            started_challenges = team_data.get('started_challenges', {})
            c_id = cdata.get('id')
            if c_id not in started_challenges:
                started_challenges[c_id] = time.time()
                db.collection('teams').document(session['team_id']).update({'started_challenges': started_challenges})
                # Update local team_data so subsequent loops (unlikely but possible) see it
                team_data['started_challenges'] = started_challenges

    if not key_valid and user_key:
        # Check if key is for another color
        all_docs2 = db.collection('rounds').document(active_phase).collection('challenges').stream()
        other_color_match = any(d.to_dict().get('unlock_key') == user_key for d in all_docs2)
        if other_color_match:
            return jsonify({'success': False, 'message': f'SECTOR MISMATCH: This key is for a different sector.'})
        return jsonify({'success': False, 'message': f'Invalid Key for {active_phase}.'})

    # Sort by difficulty order
    team_challenges.sort(key=lambda c: diff_order.get(c.get('difficulty', 'easy'), 99))

    # Annotate each challenge with lock status
    challenges_out = []
    for c in team_challenges:
        chal_order = diff_order.get(c.get('difficulty', 'easy'), 99)
        if chal_order < r1_prog:
            status = 'completed'
        elif chal_order == r1_prog:
            status = 'unlocked'
        else:
            status = 'locked'

        challenges_out.append({
            'id': c.get('id'),
            'title': c.get('title', 'Untitled'),
            'difficulty': c.get('difficulty', 'easy'),
            'status': status
        })

    return jsonify({'success': True, 'phase': active_phase, 'r1_prog': r1_prog, 'challenges': challenges_out})

@app.route('/api/get-challenge/<challenge_id>', methods=['GET'])
def get_challenge_by_id(challenge_id):
    """Fetch a specific challenge by ID for a logged-in team.
    Verifies the team has access based on their round1_progress."""
    if 'team_id' not in session:
        return jsonify({'success': False, 'message': 'Not logged in.'}), 401

    active_phase = get_active_phase()
    if active_phase == 'Stop':
        return jsonify({'success': False, 'message': 'SESSION PAUSED by Admin.'}), 403

    team_doc = db.collection('teams').document(session['team_id']).get()
    team_data = team_doc.to_dict() or {}

    if not team_doc.exists or team_data.get('status') in ['DQ', 'Deleted']:
        return jsonify({'success': False, 'message': 'ACCESS DENIED: Your team has been terminated.'}), 403

    team_color = team_data.get('color')
    r1_prog = team_data.get('round1_progress', 0)
    diff_order = {'easy': 0, 'medium': 1, 'hard': 2}

    if not team_color:
        return jsonify({'success': False, 'message': 'UNASSIGNED COLOR: Contact admin.'})

    # Fetch the specific challenge
    chal_doc = db.collection('rounds').document(active_phase).collection('challenges').document(challenge_id).get()
    if not chal_doc.exists:
        return jsonify({'success': False, 'message': 'Challenge not found.'}), 404

    chal_data = chal_doc.to_dict()
    chal_data['id'] = chal_doc.id

    # Verify the challenge belongs to this team's color
    if chal_data.get('color') != team_color:
        return jsonify({'success': False, 'message': 'SECTOR MISMATCH: This challenge is not for your sector.'})

    # Verify the team has sufficient progress to access this challenge
    chal_diff = chal_data.get('difficulty', 'easy')
    chal_order = diff_order.get(chal_diff, 0)

    if chal_order > r1_prog:
        return jsonify({'success': False, 'message': f'LOCKED: Complete previous levels before accessing {chal_diff}.'})

    if chal_order < r1_prog:
        return jsonify({'success': False, 'message': f'ALREADY COMPLETED: You have already passed this level.'})

    # TIMER TRACKING
    started_challenges = team_data.get('started_challenges', {})
    duration = int(chal_data.get('duration', 1800))
    
    if challenge_id not in started_challenges:
        # Fallback if somehow they bypassed /unlock (e.g., admin manual entry)
        start_time = time.time()
        started_challenges[challenge_id] = start_time
        db.collection('teams').document(session['team_id']).update({'started_challenges': started_challenges})
    else:
        start_time = started_challenges[challenge_id]

    elapsed = time.time() - start_time
    remaining_time = max(0, duration - int(elapsed))
    chal_data['duration'] = remaining_time

    return jsonify({'success': True, 'challenge': chal_data})

# --- CODE EXECUTION BACKEND ---

@app.route('/execute', methods=['POST'])
def execute_code():
    if 'team_id' not in session:
        return jsonify({'error': 'Not logged in.'}), 401
        
    team_doc = db.collection('teams').document(session['team_id']).get()
    if not team_doc.exists or team_doc.to_dict().get('status') in ['DQ', 'Deleted']:
        return jsonify({'error': 'ACCESS DENIED: Your team has been terminated.'}), 403

    data = request.json
    language = data.get('language')
    code = data.get('code')
    user_input = data.get('user_input', '')

    if not code or not language:
        return jsonify({'error': 'Missing code or language'}), 400

    # Create a unique session directory in /tmp
    session_id = str(uuid.uuid4())
    # On Windows, use a path Docker Desktop can definitely mount, like a subfolder in CWD
    # We will use the 'tmp' folder inside the project directory to avoid Windows temp path issues mapping to Docker.
    host_tmp_dir = os.path.join(os.getcwd(), 'tmp_execution', session_id)
    os.makedirs(host_tmp_dir, exist_ok=True)
    
    # Define mapping of language to file extension and docker commands
    # We mount host_tmp_dir to /sandbox inside the container
    import re
    
    file_names = {
        'python_code': 'temp_code.py',
        'c_code': 'temp_code.c',
        'java_code': 'TempCode.java' # Default
    }

    if language == 'java_code':
        # Extract the public class name from the Java code to create the correct file
        match = re.search(r'public\s+class\s+(\w+)', code)
        if match:
            class_name = match.group(1)
            file_names['java_code'] = f"{class_name}.java"
            commands_java = f"javac /sandbox/{class_name}.java && java -cp /sandbox {class_name}"
        else:
            commands_java = "javac /sandbox/TempCode.java && java -cp /sandbox TempCode"
    
    if language not in file_names:
        return jsonify({'error': 'Unsupported language'}), 400

    file_name = file_names[language]
    file_path = os.path.join(host_tmp_dir, file_name)

    with open(file_path, 'w') as f:
        f.write(code)

    # Convert Windows path to Docker-compatible WSL/Windows path format for volume mounting
    # Python absolute paths on Windows (C:\...) work directly with Docker Desktop Windows
    mount_arg = f"{host_tmp_dir}:/sandbox"
    
    commands = {
        'python_code': f"python3 /sandbox/{file_name}",
        'c_code': f"gcc /sandbox/{file_name} -o /sandbox/a.out && /sandbox/a.out",
        'java_code': commands_java if language == 'java_code' else ''
    }

    docker_cmd = [
        "docker", "run", "--rm", "-i", # -i is crucial for STDIN
        "--memory=128m", "--cpus=0.5",  # resource limits
        "-v", mount_arg,
        "relay-runner",
        "bash", "-c", commands[language]
    ]

    try:
        # Run docker command with a 5-second timeout
        result = subprocess.run(
            docker_cmd, 
            input=user_input,     # Pass input directly to STDIN
            capture_output=True, 
            text=True, 
            timeout=5
        )
        output = result.stdout
        error = result.stderr
        
        # Determine success
        success = result.returncode == 0
        
    except subprocess.TimeoutExpired:
        success = False
        output = ""
        error = "Error: Execution Timed Out (> 5 seconds). Infinite loop detected?"
    except Exception as e:
        success = False
        output = ""
        error = f"Internal execution error: {str(e)}"
    finally:
        # Clean up files after execution (optional, could lead to permission errors on Windows if docker holds locks, but --rm helps)
        pass

    return jsonify({
        'success': success,
        'output': output,
        'error': error
    })

@app.route('/submit', methods=['POST'])
def submit_code():
    """Evaluates code against multiple test cases"""
    if 'team_id' not in session:
        return jsonify({'error': 'Not logged in.'}), 401
        
    team_doc = db.collection('teams').document(session['team_id']).get()
    if not team_doc.exists or team_doc.to_dict().get('status') in ['DQ', 'Deleted']:
        return jsonify({'error': 'ACCESS DENIED: Your team has been terminated.'}), 403

    data = request.json
    language = data.get('language')
    code = data.get('code')
    test_cases = data.get('test_cases', [])
    challenge_id = data.get('challenge_id')
    force_progress = data.get('force_progress', False)

    if not code or not language:
        return jsonify({'error': 'Missing code or language'}), 400
    if not test_cases:
        return jsonify({'error': 'No test cases provided'}), 400

    session_id = str(uuid.uuid4())
    host_tmp_dir = os.path.join(os.getcwd(), 'tmp_execution', session_id)
    os.makedirs(host_tmp_dir, exist_ok=True)
    
    import re
    file_names = {
        'python_code': 'temp_code.py',
        'c_code': 'temp_code.c',
        'java_code': 'TempCode.java'
    }

    if language == 'java_code':
        match = re.search(r'public\s+class\s+(\w+)', code)
        if match:
            class_name = match.group(1)
            file_names['java_code'] = f"{class_name}.java"
        else:
            class_name = "TempCode"
    else:
        # Define a dummy class_name for non-java languages to prevent potential NameError
        class_name = "TempCode"
            
    if language not in file_names:
        return jsonify({'error': 'Unsupported language'}), 400

    file_name = file_names[language]
    file_path = os.path.join(host_tmp_dir, file_name)
    
    with open(file_path, 'w') as f:
        f.write(code)

    # Convert Windows path to Docker-friendly path (forward slashes)
    docker_host_path = host_tmp_dir.replace('\\', '/')
    mount_arg = f"{docker_host_path}:/sandbox"
    
    print(f"[DEBUG] Session {session_id} - Language: {language} - Mount: {mount_arg}")
    
    # 1. Compilation Phase (C & Java)
    if language == 'c_code':
        compile_cmd = ["docker", "run", "--rm", "-v", mount_arg, "relay-runner", "gcc", f"/sandbox/{file_name}", "-o", "/sandbox/a.out"]
        try:
            comp_res = subprocess.run(compile_cmd, capture_output=True, text=True, timeout=10)
            if comp_res.returncode != 0:
                return jsonify({'success': False, 'error': "Compilation Failed:\n" + comp_res.stderr})
        except subprocess.TimeoutExpired:
            return jsonify({'success': False, 'error': "Compilation Timed Out."})
        except Exception as e:
            err_msg = str(e)
            if "docker" in err_msg.lower() and "connect" in err_msg.lower():
                err_msg = "Docker Desktop is not running or unreachable. Please start Docker to enable code execution."
            return jsonify({'success': False, 'error': err_msg})
            
    elif language == 'java_code':
        compile_cmd = ["docker", "run", "--rm", "-v", mount_arg, "relay-runner", "javac", f"/sandbox/{file_name}"]
        try:
            comp_res = subprocess.run(compile_cmd, capture_output=True, text=True, timeout=10)
            if comp_res.returncode != 0:
                return jsonify({'success': False, 'error': "Compilation Failed:\n" + comp_res.stderr})
        except subprocess.TimeoutExpired:
            return jsonify({'success': False, 'error': "Compilation Timed Out."})
        except Exception as e:
            err_msg = str(e)
            if any(term in err_msg.lower() for term in ["docker", "connect", "pipe"]):
                err_msg = "Docker Desktop is not running or unreachable. Please start Docker to enable code execution."
            return jsonify({'success': False, 'error': err_msg})

    # 2. Execution Phase (Iterate over test cases)
    results = []
    
    # Define execution commands for the actual run
    run_args = []
    if language == 'python_code':
        run_args = ["python3", f"/sandbox/{file_name}"]
    elif language == 'c_code':
        run_args = ["/sandbox/a.out"]
    elif language == 'java_code':
        run_args = ["java", "-cp", "/sandbox", class_name]


    for i, case in enumerate(test_cases):
        test_input = str(case.get('input', ''))
        expected_output = str(case.get('output', '')).strip()
        
        docker_cmd = [
            "docker", "run", "--rm", "-i", # -i is crucial for STDIN
            "--memory=128m", "--cpus=0.5",
            "-v", mount_arg,
            "relay-runner"
        ] + run_args
        
        try:
            result = subprocess.run(
                docker_cmd, 
                input=test_input,     # Pass input directly to STDIN
                capture_output=True, 
                text=True, 
                timeout=5
            )
            actual_output = result.stdout.strip()
            error_output = result.stderr.strip()
            
            passed = (actual_output == expected_output) and (result.returncode == 0)
            
            results.append({
                'case_index': i,
                'input': test_input,
                'expected': expected_output,
                'actual': actual_output,
                'error': error_output,
                'passed': passed
            })
            
        except subprocess.TimeoutExpired:
            results.append({
                'case_index': i,
                'input': test_input,
                'expected': expected_output,
                'actual': "",
                'error': "Execution Timed Out. Please check for infinite loops or inefficient logic.",
                'passed': False
            })
        except Exception as e:
            results.append({
                'case_index': i,
                'input': test_input,
                'expected': expected_output,
                'actual': "",
                'error': "An execution warning occurred. Please check your logic and syntax.",
                'passed': False
            })
            
        # Scrub raw errors before returning to frontend
        if results[-1]['error']:
            print(f"[DEBUG] Execution Error for Case {i}: {results[-1]['error']}")
            if not results[-1]['error'].startswith("Execution Timed Out") and not results[-1]['error'].startswith("An execution warning"):
                results[-1]['error'] = "An error occurred during execution. Please check your logic and syntax."

            
    all_passed = all(r['passed'] for r in results)
    
    returned_hint = ""
    team_id = session.get('team_id')
    
    if team_id and challenge_id:
        team_ref = db.collection('teams').document(team_id)
        try:
            team_doc = team_ref.get()
            if team_doc.exists:
                team_data = team_doc.to_dict()
                testcase_scores = team_data.get('testcase_scores', {})
                current_cases = testcase_scores.get(challenge_id, [])
                
                # If they previously had an integer score here, reset it to empty list for the new format
                if isinstance(current_cases, (int, float)):
                    current_cases = []
                    
                passed_indices = set(current_cases)
                for r in results:
                    if r['passed']:
                        passed_indices.add(r['case_index'])
                        
                if len(passed_indices) > len(current_cases) or len(current_cases) == 0:
                    testcase_scores[challenge_id] = list(passed_indices)
                    team_ref.update({
                        'testcase_scores': testcase_scores,
                        'last_score_time': time.time()
                    })
        except Exception as e:
            print(f"Error updating testcase score: {e}")
            
        if all_passed or force_progress:
            active_phase = get_active_phase()
            # Fetch challenge doc to know exactly what it was
            chal_doc = db.collection('rounds').document(active_phase).collection('challenges').document(challenge_id).get()
            if chal_doc.exists:
                cdata = chal_doc.to_dict()
                diff_order = {'easy': 0, 'medium': 1, 'hard': 2}
                team_ref = db.collection('teams').document(team_id)
                
                if active_phase == 'Round 1':
                    c_diff = cdata.get('difficulty', 'easy')
                    c_order = diff_order.get(c_diff, 0)
                    # Force progression to the next level
                    next_order = c_order + 1
                    try:
                        team_doc = team_ref.get()
                        if team_doc.exists:
                            cur_prog = team_doc.to_dict().get('round1_progress', 0)
                            if next_order > cur_prog:
                                team_ref.update({'round1_progress': next_order})
                    except Exception as ex:
                        print("Could not update progress:", ex)
                
                elif active_phase == 'Round 2':
                    team_ref.update({
                        'round2_solved': True,
                        'last_score_time': time.time()
                    })

    return jsonify({
        'success': True,
        'results': results
    })

if __name__ == '__main__':
    # '0.0.0.0' makes the server accessible over the local network
    app.run(host='0.0.0.0', port=5000, debug=True)