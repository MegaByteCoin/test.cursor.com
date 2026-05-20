import json
import os
import hashlib
import secrets
from functools import wraps

import numpy as np
from flask import (
    Flask, render_template, request, jsonify, session, redirect, url_for
)
from werkzeug.security import generate_password_hash, check_password_hash

from models import get_db, init_db

app = Flask(__name__)
app.secret_key = os.environ.get('SECRET_KEY', secrets.token_hex(32))

# ---------------------------------------------------------------------------
# Sentence-Transformers model (lazy-loaded singleton)
# ---------------------------------------------------------------------------
_model = None
MODEL_NAME = 'sentence-transformers/all-mpnet-base-v2'
MODEL_CACHE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'model_cache')


def get_model():
    global _model
    if _model is None:
        from sentence_transformers import SentenceTransformer
        _model = SentenceTransformer(MODEL_NAME, cache_folder=MODEL_CACHE)
    return _model


def encode_text(text: str) -> list[float]:
    model = get_model()
    vec = model.encode(text, normalize_embeddings=True)
    return vec.tolist()


def cosine_similarity(a: list[float], b: list[float]) -> float:
    a_np = np.array(a, dtype=np.float32)
    b_np = np.array(b, dtype=np.float32)
    dot = np.dot(a_np, b_np)
    norm = np.linalg.norm(a_np) * np.linalg.norm(b_np)
    if norm == 0:
        return 0.0
    return float(dot / norm)


# ---------------------------------------------------------------------------
# Auth helpers
# ---------------------------------------------------------------------------
def login_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if 'user_id' not in session:
            if request.headers.get('X-Requested-With') == 'XMLHttpRequest':
                return jsonify({'error': 'Unauthorized'}), 401
            return redirect(url_for('login_page'))
        return f(*args, **kwargs)
    return decorated


def current_user_id():
    return session.get('user_id')


# ---------------------------------------------------------------------------
# Pages
# ---------------------------------------------------------------------------
@app.route('/')
def index():
    if 'user_id' in session:
        return redirect(url_for('main_app'))
    return redirect(url_for('login_page'))


@app.route('/login')
def login_page():
    return render_template('login.html')


@app.route('/register')
def register_page():
    return render_template('register.html')


@app.route('/app')
@login_required
def main_app():
    db = get_db()
    user = db.execute('SELECT * FROM users WHERE id = ?',
                      (current_user_id(),)).fetchone()
    db.close()
    return render_template('app.html', user=user)


# ---------------------------------------------------------------------------
# Auth API
# ---------------------------------------------------------------------------
@app.route('/api/register', methods=['POST'])
def api_register():
    data = request.get_json(force=True)
    username = data.get('username', '').strip()
    password = data.get('password', '').strip()
    display_name = data.get('display_name', '').strip() or username

    if not username or not password:
        return jsonify({'error': 'Логин и пароль обязательны'}), 400
    if len(username) < 3:
        return jsonify({'error': 'Логин минимум 3 символа'}), 400
    if len(password) < 4:
        return jsonify({'error': 'Пароль минимум 4 символа'}), 400

    db = get_db()
    existing = db.execute('SELECT id FROM users WHERE username = ?',
                          (username,)).fetchone()
    if existing:
        db.close()
        return jsonify({'error': 'Пользователь уже существует'}), 409

    pw_hash = generate_password_hash(password)
    cursor = db.execute(
        'INSERT INTO users (username, password_hash, display_name) VALUES (?, ?, ?)',
        (username, pw_hash, display_name)
    )
    db.commit()
    user_id = cursor.lastrowid
    db.close()

    session['user_id'] = user_id
    session['username'] = username
    return jsonify({'ok': True, 'user_id': user_id})


@app.route('/api/login', methods=['POST'])
def api_login():
    data = request.get_json(force=True)
    username = data.get('username', '').strip()
    password = data.get('password', '').strip()

    db = get_db()
    user = db.execute('SELECT * FROM users WHERE username = ?',
                      (username,)).fetchone()
    db.close()

    if not user or not check_password_hash(user['password_hash'], password):
        return jsonify({'error': 'Неверный логин или пароль'}), 401

    session['user_id'] = user['id']
    session['username'] = user['username']
    return jsonify({'ok': True, 'user_id': user['id']})


@app.route('/api/logout', methods=['POST'])
def api_logout():
    session.clear()
    return jsonify({'ok': True})


# ---------------------------------------------------------------------------
# Search API — People & Bots
# ---------------------------------------------------------------------------
@app.route('/api/search/people')
@login_required
def api_search_people():
    q = request.args.get('q', '').strip()
    db = get_db()
    if q:
        rows = db.execute(
            "SELECT id, username, display_name, avatar_url, allow_messages, allow_friends "
            "FROM users WHERE username LIKE ? OR display_name LIKE ? ORDER BY id",
            (f'%{q}%', f'%{q}%')
        ).fetchall()
    else:
        rows = db.execute(
            "SELECT id, username, display_name, avatar_url, allow_messages, allow_friends "
            "FROM users ORDER BY id"
        ).fetchall()
    db.close()
    return jsonify([dict(r) for r in rows])


@app.route('/api/search/bots')
@login_required
def api_search_bots():
    q = request.args.get('q', '').strip()
    db = get_db()
    if q:
        rows = db.execute(
            "SELECT b.id, b.name, b.creator_id, b.allow_messages, b.allow_friends, "
            "u.username AS creator_name, "
            "(SELECT COUNT(*) FROM user_bot_memory WHERE bot_id = b.id) AS phrases_count "
            "FROM user_bots b JOIN users u ON b.creator_id = u.id "
            "WHERE b.name LIKE ? ORDER BY b.id",
            (f'%{q}%',)
        ).fetchall()
    else:
        rows = db.execute(
            "SELECT b.id, b.name, b.creator_id, b.allow_messages, b.allow_friends, "
            "u.username AS creator_name, "
            "(SELECT COUNT(*) FROM user_bot_memory WHERE bot_id = b.id) AS phrases_count "
            "FROM user_bots b JOIN users u ON b.creator_id = u.id ORDER BY b.id"
        ).fetchall()
    db.close()
    return jsonify([dict(r) for r in rows])


# ---------------------------------------------------------------------------
# Bot Management API
# ---------------------------------------------------------------------------
@app.route('/api/bots', methods=['GET'])
@login_required
def api_my_bots():
    db = get_db()
    rows = db.execute(
        "SELECT b.*, "
        "(SELECT COUNT(*) FROM user_bot_memory WHERE bot_id = b.id) AS phrases_count "
        "FROM user_bots b WHERE b.creator_id = ? ORDER BY b.id",
        (current_user_id(),)
    ).fetchall()
    db.close()
    return jsonify([dict(r) for r in rows])


@app.route('/api/bots', methods=['POST'])
@login_required
def api_create_bot():
    data = request.get_json(force=True)
    name = data.get('name', '').strip()
    if not name:
        return jsonify({'error': 'Имя бота обязательно'}), 400
    if len(name) > 50:
        return jsonify({'error': 'Имя бота не более 50 символов'}), 400

    db = get_db()
    cursor = db.execute(
        'INSERT INTO user_bots (creator_id, name) VALUES (?, ?)',
        (current_user_id(), name)
    )
    db.commit()
    bot_id = cursor.lastrowid
    db.close()
    return jsonify({'ok': True, 'bot_id': bot_id})


@app.route('/api/bots/<int:bot_id>', methods=['DELETE'])
@login_required
def api_delete_bot(bot_id):
    db = get_db()
    bot = db.execute('SELECT * FROM user_bots WHERE id = ? AND creator_id = ?',
                     (bot_id, current_user_id())).fetchone()
    if not bot:
        db.close()
        return jsonify({'error': 'Бот не найден'}), 404
    db.execute('DELETE FROM user_bot_memory WHERE bot_id = ?', (bot_id,))
    db.execute('DELETE FROM user_bots WHERE id = ?', (bot_id,))
    db.commit()
    db.close()
    return jsonify({'ok': True})


@app.route('/api/bots/<int:bot_id>/privacy', methods=['PUT'])
@login_required
def api_update_bot_privacy(bot_id):
    data = request.get_json(force=True)
    db = get_db()
    bot = db.execute('SELECT * FROM user_bots WHERE id = ? AND creator_id = ?',
                     (bot_id, current_user_id())).fetchone()
    if not bot:
        db.close()
        return jsonify({'error': 'Бот не найден'}), 404

    allow_messages = 1 if data.get('allow_messages') else 0
    allow_friends = 1 if data.get('allow_friends') else 0

    db.execute(
        'UPDATE user_bots SET allow_messages = ?, allow_friends = ? WHERE id = ?',
        (allow_messages, allow_friends, bot_id)
    )
    db.commit()
    db.close()
    return jsonify({'ok': True})


# ---------------------------------------------------------------------------
# Bot Training API
# ---------------------------------------------------------------------------
@app.route('/api/bots/<int:bot_id>/train', methods=['POST'])
@login_required
def api_train_bot(bot_id):
    db = get_db()
    bot = db.execute('SELECT * FROM user_bots WHERE id = ? AND creator_id = ?',
                     (bot_id, current_user_id())).fetchone()
    if not bot:
        db.close()
        return jsonify({'error': 'Бот не найден'}), 404

    data = request.get_json(force=True)
    question = data.get('question', '').strip()
    answer = data.get('answer', '').strip()

    if not question or not answer:
        db.close()
        return jsonify({'error': 'Вопрос и ответ обязательны'}), 400

    vector = encode_text(question)
    vector_json = json.dumps(vector)

    db.execute(
        'INSERT INTO user_bot_memory (bot_id, question_text, vector_data, answer_text) '
        'VALUES (?, ?, ?, ?)',
        (bot_id, question, vector_json, answer)
    )
    db.commit()

    count = db.execute(
        'SELECT COUNT(*) as c FROM user_bot_memory WHERE bot_id = ?', (bot_id,)
    ).fetchone()['c']
    db.close()

    return jsonify({'ok': True, 'phrases_count': count})


@app.route('/api/bots/<int:bot_id>/memory', methods=['GET'])
@login_required
def api_bot_memory(bot_id):
    db = get_db()
    bot = db.execute('SELECT * FROM user_bots WHERE id = ? AND creator_id = ?',
                     (bot_id, current_user_id())).fetchone()
    if not bot:
        db.close()
        return jsonify({'error': 'Бот не найден'}), 404

    rows = db.execute(
        'SELECT id, question_text, answer_text, created_at FROM user_bot_memory '
        'WHERE bot_id = ? ORDER BY id DESC',
        (bot_id,)
    ).fetchall()
    db.close()
    return jsonify([dict(r) for r in rows])


@app.route('/api/bots/<int:bot_id>/memory/<int:memory_id>', methods=['DELETE'])
@login_required
def api_delete_memory(bot_id, memory_id):
    db = get_db()
    bot = db.execute('SELECT * FROM user_bots WHERE id = ? AND creator_id = ?',
                     (bot_id, current_user_id())).fetchone()
    if not bot:
        db.close()
        return jsonify({'error': 'Бот не найден'}), 404

    db.execute('DELETE FROM user_bot_memory WHERE id = ? AND bot_id = ?',
               (memory_id, bot_id))
    db.commit()
    db.close()
    return jsonify({'ok': True})


# ---------------------------------------------------------------------------
# Chat with Bot API (Local Vector Matching)
# ---------------------------------------------------------------------------
@app.route('/api/bots/<int:bot_id>/chat', methods=['POST'])
@login_required
def api_chat_with_bot(bot_id):
    db = get_db()
    bot = db.execute('SELECT * FROM user_bots WHERE id = ?', (bot_id,)).fetchone()
    if not bot:
        db.close()
        return jsonify({'error': 'Бот не найден'}), 404

    uid = current_user_id()
    is_owner = (bot['creator_id'] == uid)

    if not is_owner and not bot['allow_messages']:
        db.close()
        return jsonify({'error': 'Создатель бота запретил отправку сообщений'}), 403

    data = request.get_json(force=True)
    message = data.get('message', '').strip()
    if not message:
        db.close()
        return jsonify({'error': 'Сообщение не может быть пустым'}), 400

    memories = db.execute(
        'SELECT question_text, vector_data, answer_text FROM user_bot_memory '
        'WHERE bot_id = ?', (bot_id,)
    ).fetchall()
    db.close()

    if not memories:
        return jsonify({
            'response': '...Бот внимательно смотрит на вас, но пока не знает, '
                        'что ответить. Обучите его этой фразе...',
            'similarity': 0.0
        })

    input_vector = encode_text(message)

    best_score = 0.0
    best_answer = ''
    for mem in memories:
        mem_vector = json.loads(mem['vector_data'])
        score = cosine_similarity(input_vector, mem_vector)
        if score > best_score:
            best_score = score
            best_answer = mem['answer_text']

    threshold = 0.75
    if best_score >= threshold:
        return jsonify({
            'response': best_answer,
            'similarity': round(best_score, 4)
        })

    return jsonify({
        'response': '...Бот внимательно смотрит на вас, но пока не знает, '
                    'что ответить. Обучите его этой фразе...',
        'similarity': round(best_score, 4)
    })


# ---------------------------------------------------------------------------
# Global AI Chat (Tech Support — Mr.IT-Architect stub)
# ---------------------------------------------------------------------------
@app.route('/api/chat', methods=['POST'])
@login_required
def api_global_chat():
    data = request.get_json(force=True)
    message = data.get('message', '').strip()
    if not message:
        return jsonify({'error': 'Сообщение не может быть пустым'}), 400

    response = (
        f'Здравствуйте! Я Mr.IT-Architect — техподдержка системы. '
        f'Вы написали: "{message}". '
        f'Данный модуль находится в стадии разработки. '
        f'Скоро здесь будет полноценный ИИ-ассистент!'
    )

    db = get_db()
    db.execute(
        'INSERT INTO chat_messages (user_id, message, response) VALUES (?, ?, ?)',
        (current_user_id(), message, response)
    )
    db.commit()
    db.close()

    return jsonify({'response': response})


@app.route('/api/chat/history', methods=['GET'])
@login_required
def api_chat_history():
    db = get_db()
    rows = db.execute(
        'SELECT message, response, created_at FROM chat_messages '
        'WHERE user_id = ? ORDER BY id DESC LIMIT 50',
        (current_user_id(),)
    ).fetchall()
    db.close()
    return jsonify([dict(r) for r in reversed(rows)])


# ---------------------------------------------------------------------------
# User Settings API
# ---------------------------------------------------------------------------
@app.route('/api/settings', methods=['GET'])
@login_required
def api_get_settings():
    db = get_db()
    user = db.execute('SELECT id, username, display_name, avatar_url FROM users WHERE id = ?',
                      (current_user_id(),)).fetchone()
    db.close()
    return jsonify(dict(user))


@app.route('/api/settings', methods=['PUT'])
@login_required
def api_update_settings():
    data = request.get_json(force=True)
    display_name = data.get('display_name', '').strip()

    if not display_name:
        return jsonify({'error': 'Имя не может быть пустым'}), 400

    db = get_db()
    db.execute('UPDATE users SET display_name = ? WHERE id = ?',
               (display_name, current_user_id()))
    db.commit()
    db.close()
    return jsonify({'ok': True})


# ---------------------------------------------------------------------------
# Bot info (public — for chat view)
# ---------------------------------------------------------------------------
@app.route('/api/bots/<int:bot_id>/info', methods=['GET'])
@login_required
def api_bot_info(bot_id):
    db = get_db()
    bot = db.execute(
        "SELECT b.id, b.name, b.creator_id, b.allow_messages, b.allow_friends, "
        "u.username AS creator_name, "
        "(SELECT COUNT(*) FROM user_bot_memory WHERE bot_id = b.id) AS phrases_count "
        "FROM user_bots b JOIN users u ON b.creator_id = u.id WHERE b.id = ?",
        (bot_id,)
    ).fetchone()
    db.close()
    if not bot:
        return jsonify({'error': 'Бот не найден'}), 404
    return jsonify(dict(bot))


# ---------------------------------------------------------------------------
# Init
# ---------------------------------------------------------------------------
init_db()

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)
