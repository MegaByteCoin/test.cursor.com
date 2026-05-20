/* =================================================================
   AI Zona — Main Application JavaScript
   All tab switching and API calls are async (Fetch + DOM)
   ================================================================= */

let currentSearchTab = 'people';
let currentManagedBotId = null;
let currentChatBotId = null;

/* ===================== TAB NAVIGATION ===================== */

function switchTab(tabName) {
    document.querySelectorAll('.tab-content').forEach(function (el) {
        el.classList.remove('active');
    });
    document.querySelectorAll('.sidebar-item').forEach(function (el) {
        el.classList.remove('active');
    });

    var tab = document.getElementById('tab-' + tabName);
    if (tab) tab.classList.add('active');

    var menuItem = document.querySelector('.sidebar-item[data-tab="' + tabName + '"]');
    if (menuItem) menuItem.classList.add('active');

    if (tabName === 'chat') loadChatHistory();
    if (tabName === 'search') doSearch();
    if (tabName === 'settings') loadMyBots();
}

document.querySelectorAll('.sidebar-item').forEach(function (item) {
    item.addEventListener('click', function () {
        switchTab(this.getAttribute('data-tab'));
    });
});

/* ===================== LOGOUT ===================== */

function doLogout() {
    fetch('/api/logout', { method: 'POST' })
        .then(function () { window.location.href = '/login'; })
        .catch(function () { window.location.href = '/login'; });
}

/* ===================== GLOBAL CHAT ===================== */

function loadChatHistory() {
    fetch('/api/chat/history')
        .then(function (r) { return r.json(); })
        .then(function (messages) {
            var container = document.getElementById('globalChatMessages');
            container.innerHTML = '';
            messages.forEach(function (m) {
                appendChatMsg(container, m.message, 'user');
                appendChatMsg(container, m.response, 'bot');
            });
            container.scrollTop = container.scrollHeight;
        });
}

function sendGlobalChat() {
    var input = document.getElementById('globalChatInput');
    var message = input.value.trim();
    if (!message) return;

    var container = document.getElementById('globalChatMessages');
    appendChatMsg(container, message, 'user');
    input.value = '';
    container.scrollTop = container.scrollHeight;

    fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
        body: JSON.stringify({ message: message })
    })
        .then(function (r) { return r.json(); })
        .then(function (data) {
            if (data.error) {
                showToast(data.error, 'error');
                return;
            }
            typeMessage(container, data.response, 'bot');
        })
        .catch(function () { showToast('Ошибка соединения', 'error'); });
}

document.getElementById('globalChatInput').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') sendGlobalChat();
});

function appendChatMsg(container, text, role) {
    var div = document.createElement('div');
    div.className = 'chat-msg ' + role;
    div.textContent = text;
    container.appendChild(div);
}

function typeMessage(container, text, role, similarity) {
    var div = document.createElement('div');
    div.className = 'chat-msg ' + role;
    container.appendChild(div);

    var cursor = document.createElement('span');
    cursor.className = 'typing-cursor';
    div.appendChild(cursor);
    container.scrollTop = container.scrollHeight;

    var i = 0;
    var textNode = document.createTextNode('');
    div.insertBefore(textNode, cursor);

    var interval = setInterval(function () {
        if (i < text.length) {
            textNode.textContent += text[i];
            i++;
            container.scrollTop = container.scrollHeight;
        } else {
            clearInterval(interval);
            cursor.remove();
            if (similarity !== undefined && similarity !== null) {
                var badge = document.createElement('div');
                badge.className = 'similarity-badge';
                badge.textContent = 'Сходство: ' + (similarity * 100).toFixed(1) + '%';
                div.appendChild(badge);
            }
        }
    }, 25);
}

/* ===================== SEARCH ===================== */

function switchSearchTab(tab) {
    currentSearchTab = tab;
    document.querySelectorAll('.search-tab').forEach(function (el) {
        el.classList.toggle('active', el.getAttribute('data-search') === tab);
    });
    doSearch();
}

function doSearch() {
    var q = document.getElementById('searchInput') ? document.getElementById('searchInput').value.trim() : '';
    var url = currentSearchTab === 'people'
        ? '/api/search/people?q=' + encodeURIComponent(q)
        : '/api/search/bots?q=' + encodeURIComponent(q);

    fetch(url, { headers: { 'X-Requested-With': 'XMLHttpRequest' } })
        .then(function (r) { return r.json(); })
        .then(function (items) {
            var container = document.getElementById('searchResults');
            container.innerHTML = '';

            if (items.length === 0) {
                container.innerHTML = '<div style="text-align:center;padding:30px;color:#9a9abf;">Ничего не найдено</div>';
                return;
            }

            if (currentSearchTab === 'people') {
                renderPeopleResults(container, items);
            } else {
                renderBotResults(container, items);
            }
        })
        .catch(function () { showToast('Ошибка загрузки', 'error'); });
}

function renderPeopleResults(container, items) {
    items.forEach(function (user) {
        var card = document.createElement('div');
        card.className = 'search-card';
        card.innerHTML =
            '<div class="search-card-info">' +
            '<div class="search-card-name">' + escapeHtml(user.display_name || user.username) + '</div>' +
            '<div class="search-card-meta">@' + escapeHtml(user.username) + '</div>' +
            '</div>' +
            '<div class="search-card-actions">' +
            '<button class="btn-sm btn-write" onclick="showToast(\'Личные сообщения в разработке\', \'info\')">Написать</button>' +
            '<button class="btn-sm btn-friend" onclick="showToast(\'Друзья в разработке\', \'info\')">Добавить в друзья</button>' +
            '</div>';
        container.appendChild(card);
    });
}

function renderBotResults(container, items) {
    items.forEach(function (bot) {
        var isOwner = bot.creator_id === CURRENT_USER_ID;
        var canWrite = isOwner || bot.allow_messages;
        var canFriend = isOwner || bot.allow_friends;

        var writeBtn, friendBtn;
        if (canWrite) {
            writeBtn = '<button class="btn-sm btn-write" onclick="openBotChat(' + bot.id + ')">Написать</button>';
        } else {
            writeBtn = '<button class="btn-sm btn-locked" title="Создатель запретил сообщения">🔒 Написать</button>';
        }
        if (canFriend) {
            friendBtn = '<button class="btn-sm btn-friend" onclick="showToast(\'Друзья в разработке\', \'info\')">Добавить в друзья</button>';
        } else {
            friendBtn = '<button class="btn-sm btn-locked" title="Создатель запретил добавление">🔒 В друзья</button>';
        }

        var card = document.createElement('div');
        card.className = 'search-card';
        card.innerHTML =
            '<div class="search-card-info">' +
            '<div class="search-card-name">🤖 ' + escapeHtml(bot.name) + '</div>' +
            '<div class="search-card-meta">Создатель: @' + escapeHtml(bot.creator_name) +
            ' · Опыт: ' + bot.phrases_count + ' фраз</div>' +
            '</div>' +
            '<div class="search-card-actions">' + writeBtn + friendBtn + '</div>';
        container.appendChild(card);
    });
}

/* ===================== BOT WORKSHOP (Settings) ===================== */

function loadMyBots() {
    fetch('/api/bots', { headers: { 'X-Requested-With': 'XMLHttpRequest' } })
        .then(function (r) { return r.json(); })
        .then(function (bots) {
            var container = document.getElementById('myBotsList');
            container.innerHTML = '';

            if (bots.length === 0) {
                container.innerHTML = '<div style="text-align:center;padding:20px;color:#9a9abf;">У вас пока нет ботов. Создайте первого!</div>';
                return;
            }

            bots.forEach(function (bot) {
                var card = document.createElement('div');
                card.className = 'bot-card';
                card.innerHTML =
                    '<div class="bot-card-info">' +
                    '<div class="bot-card-name">🤖 ' + escapeHtml(bot.name) + '</div>' +
                    '<div class="bot-card-meta">Опыт: ' + bot.phrases_count + ' фраз · ' +
                    (bot.allow_messages ? '✉️ Сообщения ✓' : '🔒 Сообщения ✗') + ' · ' +
                    (bot.allow_friends ? '👥 Друзья ✓' : '🔒 Друзья ✗') +
                    '</div>' +
                    '</div>' +
                    '<div class="bot-card-actions">' +
                    '<button class="btn-chat-bot" onclick="openBotChat(' + bot.id + ')">Чат</button>' +
                    '<button class="btn-manage" onclick="openBotManage(' + bot.id + ')">Управление</button>' +
                    '<button class="btn-delete" onclick="deleteBot(' + bot.id + ')">Удалить</button>' +
                    '</div>';
                container.appendChild(card);
            });
        });
}

function createBot() {
    var input = document.getElementById('newBotName');
    var name = input.value.trim();
    if (!name) {
        showToast('Введите имя бота', 'warning');
        return;
    }

    fetch('/api/bots', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
        body: JSON.stringify({ name: name })
    })
        .then(function (r) { return r.json(); })
        .then(function (data) {
            if (data.error) {
                showToast(data.error, 'error');
                return;
            }
            showToast('Бот "' + name + '" создан!', 'success');
            input.value = '';
            loadMyBots();
        })
        .catch(function () { showToast('Ошибка создания бота', 'error'); });
}

function deleteBot(botId) {
    if (!confirm('Удалить бота и все его уроки?')) return;

    fetch('/api/bots/' + botId, {
        method: 'DELETE',
        headers: { 'X-Requested-With': 'XMLHttpRequest' }
    })
        .then(function (r) { return r.json(); })
        .then(function (data) {
            if (data.error) {
                showToast(data.error, 'error');
                return;
            }
            showToast('Бот удалён', 'success');
            loadMyBots();
        })
        .catch(function () { showToast('Ошибка удаления', 'error'); });
}

/* ===================== BOT MANAGEMENT ===================== */

function openBotManage(botId) {
    currentManagedBotId = botId;

    fetch('/api/bots/' + botId + '/info', { headers: { 'X-Requested-With': 'XMLHttpRequest' } })
        .then(function (r) { return r.json(); })
        .then(function (bot) {
            document.getElementById('botManageTitle').textContent = '⚙️ Управление: ' + bot.name;
            document.getElementById('toggleAllowMessages').checked = !!bot.allow_messages;
            document.getElementById('toggleAllowFriends').checked = !!bot.allow_friends;
            loadBotMemory(botId);
            switchTab('botmanage');
        })
        .catch(function () { showToast('Ошибка загрузки бота', 'error'); });
}

function updateBotPrivacy() {
    if (!currentManagedBotId) return;
    var allowMessages = document.getElementById('toggleAllowMessages').checked;
    var allowFriends = document.getElementById('toggleAllowFriends').checked;

    fetch('/api/bots/' + currentManagedBotId + '/privacy', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
        body: JSON.stringify({ allow_messages: allowMessages, allow_friends: allowFriends })
    })
        .then(function (r) { return r.json(); })
        .then(function (data) {
            if (data.error) {
                showToast(data.error, 'error');
                return;
            }
            showToast('Настройки приватности обновлены', 'success');
        })
        .catch(function () { showToast('Ошибка обновления', 'error'); });
}

function trainBot() {
    if (!currentManagedBotId) return;
    var question = document.getElementById('trainQuestion').value.trim();
    var answer = document.getElementById('trainAnswer').value.trim();

    if (!question || !answer) {
        showToast('Заполните оба поля', 'warning');
        return;
    }

    showToast('Обучаю бота... Кодирую вектор смысла...', 'info');

    fetch('/api/bots/' + currentManagedBotId + '/train', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
        body: JSON.stringify({ question: question, answer: answer })
    })
        .then(function (r) { return r.json(); })
        .then(function (data) {
            if (data.error) {
                showToast(data.error, 'error');
                return;
            }
            showToast('Фраза выучена! Опыт: ' + data.phrases_count, 'success');
            document.getElementById('trainQuestion').value = '';
            document.getElementById('trainAnswer').value = '';
            loadBotMemory(currentManagedBotId);
        })
        .catch(function () { showToast('Ошибка обучения', 'error'); });
}

function loadBotMemory(botId) {
    fetch('/api/bots/' + botId + '/memory', { headers: { 'X-Requested-With': 'XMLHttpRequest' } })
        .then(function (r) { return r.json(); })
        .then(function (items) {
            var container = document.getElementById('botMemoryList');
            container.innerHTML = '';

            if (items.length === 0) {
                container.innerHTML = '<div style="text-align:center;padding:20px;color:#9a9abf;">Бот ещё ничего не выучил</div>';
                return;
            }

            items.forEach(function (mem) {
                var div = document.createElement('div');
                div.className = 'memory-item';
                div.innerHTML =
                    '<div class="memory-item-content">' +
                    '<div class="memory-q">В: ' + escapeHtml(mem.question_text) + '</div>' +
                    '<div class="memory-a">О: ' + escapeHtml(mem.answer_text) + '</div>' +
                    '</div>' +
                    '<button class="memory-delete" onclick="deleteMemory(' + botId + ',' + mem.id + ')">✕</button>';
                container.appendChild(div);
            });
        });
}

function deleteMemory(botId, memoryId) {
    fetch('/api/bots/' + botId + '/memory/' + memoryId, {
        method: 'DELETE',
        headers: { 'X-Requested-With': 'XMLHttpRequest' }
    })
        .then(function (r) { return r.json(); })
        .then(function (data) {
            if (data.error) {
                showToast(data.error, 'error');
                return;
            }
            showToast('Фраза удалена', 'success');
            loadBotMemory(botId);
        });
}

/* ===================== BOT CHAT ===================== */

function openBotChat(botId) {
    currentChatBotId = botId;
    document.getElementById('botChatMessages').innerHTML = '';

    fetch('/api/bots/' + botId + '/info', { headers: { 'X-Requested-With': 'XMLHttpRequest' } })
        .then(function (r) { return r.json(); })
        .then(function (bot) {
            if (bot.error) {
                showToast(bot.error, 'error');
                return;
            }
            document.getElementById('botChatTitle').textContent = '🤖 Чат с ' + bot.name;
            switchTab('botchat');

            var container = document.getElementById('botChatMessages');
            var greeting = document.createElement('div');
            greeting.className = 'chat-msg bot';
            greeting.textContent = 'Привет! Я ' + bot.name + '. У меня ' + bot.phrases_count + ' выученных фраз. Напишите мне что-нибудь!';
            container.appendChild(greeting);
        })
        .catch(function () { showToast('Ошибка загрузки бота', 'error'); });
}

function sendBotChat() {
    if (!currentChatBotId) return;
    var input = document.getElementById('botChatInput');
    var message = input.value.trim();
    if (!message) return;

    var container = document.getElementById('botChatMessages');
    appendChatMsg(container, message, 'user');
    input.value = '';
    container.scrollTop = container.scrollHeight;

    fetch('/api/bots/' + currentChatBotId + '/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
        body: JSON.stringify({ message: message })
    })
        .then(function (r) { return r.json(); })
        .then(function (data) {
            if (data.error) {
                showToast(data.error, 'error');
                return;
            }
            typeMessage(container, data.response, 'bot', data.similarity);
        })
        .catch(function () { showToast('Ошибка соединения', 'error'); });
}

document.getElementById('botChatInput').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') sendBotChat();
});

/* ===================== PROFILE SETTINGS ===================== */

function saveProfile() {
    var displayName = document.getElementById('settingsDisplayName').value.trim();
    if (!displayName) {
        showToast('Имя не может быть пустым', 'warning');
        return;
    }

    fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
        body: JSON.stringify({ display_name: displayName })
    })
        .then(function (r) { return r.json(); })
        .then(function (data) {
            if (data.error) {
                showToast(data.error, 'error');
                return;
            }
            showToast('Профиль сохранён!', 'success');
            document.querySelector('.header-username').textContent = displayName;
        })
        .catch(function () { showToast('Ошибка сохранения', 'error'); });
}

/* ===================== UTILITY ===================== */

function escapeHtml(text) {
    var div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/* ===================== INIT ===================== */
loadChatHistory();
