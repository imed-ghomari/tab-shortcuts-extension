const api = typeof browser !== 'undefined' ? browser : chrome;
const params = new URLSearchParams(location.search);
const action = params.get('action');
const app = document.getElementById('app');
const sourceWindowId = parseInt(params.get('sourceWindowId'));
const focusTabId = parseInt(params.get('focusTabId'));

let errEl = null;

function err(msg, detail) {
  if (!errEl) {
    errEl = document.createElement('pre');
    errEl.style.cssText = 'color:#d93025;font-size:12px;margin:8px 0 0;white-space:pre-wrap;background:#fce8e6;padding:8px;border-radius:6px;';
    app.appendChild(errEl);
  }
  errEl.textContent = msg + (detail ? '\n' + detail : '');
  console.error('[TabShortcuts]', msg, detail);
}

function fuzzyMatch(query, target) {
  const q = query.toLowerCase();
  const t = (target || '').toLowerCase();
  let qi = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (q[qi] === t[ti]) qi++;
  }
  return qi === q.length;
}

async function restoreFocus() {
  try {
    if (!Number.isNaN(focusTabId)) {
      await api.tabs.update(focusTabId, { active: true });
    }
    if (!Number.isNaN(sourceWindowId)) {
      await api.windows.update(sourceWindowId, { focused: true });
    }
  } catch (_) {}
}

function setDialogTitle(title) {
  document.title = title;
}

if (action === 'name-group') {
  const groupId = parseInt(params.get('groupId'));
  const existingTitle = params.get('existingTitle') || '';
  const isRename = params.get('mode') === 'rename';
  setDialogTitle(isRename ? 'Rename Tab Group' : 'Name Tab Group');

  app.innerHTML = `
    <h2>${isRename ? 'Rename group' : 'Name your tab group'}</h2>
    <input type="text" id="groupName" placeholder="Enter group name..." autofocus />
    <div class="buttons">
      <button id="cancelBtn">Cancel</button>
      <button id="saveBtn">${isRename ? 'Rename' : 'Create Group'}</button>
    </div>
  `;

  const input = document.getElementById('groupName');

  if (isRename) {
    input.value = existingTitle;
    input.select();
  }

  document.getElementById('saveBtn').addEventListener('click', () => {
    const name = input.value.trim();
    if (!name) { window.close(); return; }
    api.tabGroups.update(groupId, { title: name })
      .then(() => window.close())
      .catch(e => err('Failed to save name', e && e.message));
  });

  document.getElementById('cancelBtn').addEventListener('click', () => window.close());

  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('saveBtn').click();
    if (e.key === 'Escape') window.close();
  });

} else if (action === 'move-tab') {
  const tabIds = params.get('tabIds').split(',').map(id => parseInt(id));
  const windowId = parseInt(params.get('windowId'));
  setDialogTitle('Move Tab To Group');

  app.innerHTML = `
    <h2>Move tab to group</h2>
    <input type="text" id="search" placeholder="Search or create group..." autofocus />
    <ul id="groupList" role="listbox"></ul>
  `;

  const searchInput = document.getElementById('search');
  const groupList = document.getElementById('groupList');
  let groups = [];
  let filteredGroups = [];
  let selectedIndex = -1;

  function getOptionCount(query) {
    if (!query && filteredGroups.length === 0) return 0;
    if (query && filteredGroups.length === 0) return 1;
    return filteredGroups.length;
  }

  function clampSelection(query) {
    const optionCount = getOptionCount(query);
    if (optionCount === 0) {
      selectedIndex = -1;
      return;
    }
    if (selectedIndex < 0 || selectedIndex >= optionCount) {
      selectedIndex = 0;
    }
  }

  function renderGroups(query) {
    filteredGroups = query ? groups.filter(g => fuzzyMatch(query, g.title || '')) : groups;
    clampSelection(query);
    groupList.innerHTML = '';

    if (filteredGroups.length === 0 && !query) {
      groupList.innerHTML = '<li class="empty-msg">No tab groups yet. Type a name to create one.</li>';
      return;
    }

    for (const [index, group] of filteredGroups.entries()) {
      const li = document.createElement('li');
      li.textContent = group.title || 'Unnamed Group';
      li.setAttribute('role', 'option');
      li.setAttribute('aria-selected', index === selectedIndex ? 'true' : 'false');
      if (group.color) li.textContent = '● ' + li.textContent;
      li.addEventListener('mousemove', () => {
        if (selectedIndex !== index) {
          selectedIndex = index;
          renderGroups(searchInput.value.trim());
        }
      });
      li.addEventListener('click', () => moveToGroup(group.id));
      if (index === selectedIndex) li.classList.add('selected');
      groupList.appendChild(li);
    }

    if (filteredGroups.length === 0 && query) {
      const li = document.createElement('li');
      li.textContent = 'Create \"' + query + '\"';
      li.className = 'create-new';
      li.setAttribute('role', 'option');
      li.setAttribute('aria-selected', selectedIndex === 0 ? 'true' : 'false');
      li.addEventListener('mousemove', () => {
        if (selectedIndex !== 0) {
          selectedIndex = 0;
          renderGroups(searchInput.value.trim());
        }
      });
      if (selectedIndex === 0) li.classList.add('selected');
      li.addEventListener('click', () => createAndMove(query));
      groupList.appendChild(li);
    }

    const selectedEl = groupList.querySelector('.selected');
    if (selectedEl) {
      selectedEl.scrollIntoView({ block: 'nearest' });
    }
  }

  function moveSelection(direction) {
    const query = searchInput.value.trim();
    const optionCount = getOptionCount(query);
    if (optionCount === 0) return;
    if (selectedIndex === -1) {
      selectedIndex = 0;
    } else {
      selectedIndex = (selectedIndex + direction + optionCount) % optionCount;
    }
    renderGroups(query);
  }

  async function activateSelection() {
    const query = searchInput.value.trim();
    if (filteredGroups.length > 0 && selectedIndex >= 0) {
      await moveToGroup(filteredGroups[selectedIndex].id);
      return;
    }
    if (query) {
      await createAndMove(query);
    }
  }

  searchInput.addEventListener('input', () => {
    selectedIndex = 0;
    renderGroups(searchInput.value.trim());
  });

  function handleMoveDialogKeydown(e) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      moveSelection(1);
      return true;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      moveSelection(-1);
      return true;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      activateSelection();
      return true;
    }
    if (e.key === 'Escape') {
      window.close();
      return true;
    }
    return false;
  }

  searchInput.addEventListener('keydown', handleMoveDialogKeydown);
  document.addEventListener('keydown', e => {
    if (e.target === searchInput) return;
    handleMoveDialogKeydown(e);
  });

  async function moveToGroup(groupId) {
    try {
      await api.tabs.group({ tabIds, groupId });
      await restoreFocus();
      window.close();
    } catch (e) {
      err('Failed to move tab', e && e.message);
    }
  }

  async function createAndMove(name) {
    try {
      const currentWindowTabs = await api.tabs.query(Number.isNaN(windowId) ? {} : { windowId });
      const groupedTabIds = currentWindowTabs
        .filter(tab => tabIds.includes(tab.id) && tab.groupId !== -1)
        .map(tab => tab.id);

      if (groupedTabIds.length > 0) {
        await api.tabs.ungroup(groupedTabIds);
      }

      const groupOptions = { tabIds };
      if (!Number.isNaN(windowId)) {
        groupOptions.createProperties = { windowId };
      }

      const newGroupId = await api.tabs.group(groupOptions);
      await api.tabGroups.update(newGroupId, { title: name });
      await restoreFocus();
      window.close();
    } catch (e) {
      err('Failed to create group', e && e.message);
    }
  }

  api.tabGroups.query(Number.isNaN(windowId) ? {} : { windowId })
    .then(result => {
      groups = result || [];
      renderGroups('');
    })
    .catch(e => {
      err('Failed to load tab groups', e && e.message);
    });
} else {
  app.innerHTML = '<h2>Unknown action</h2>';
}
