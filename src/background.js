const api = typeof browser !== 'undefined' ? browser : chrome;
const promptedStartupGroupIds = new Set();

api.runtime.onStartup.addListener(() => ensureActiveTabsGroupedOnLaunch());
api.runtime.onInstalled.addListener(() => ensureActiveTabsGroupedOnLaunch());
api.windows.onCreated.addListener(window => {
  if (window.type === 'normal') {
    queueEnsureActiveTabsGrouped();
  }
});

api.commands.onCommand.addListener((command, tab) => {
  if (!tab) return;
  switch (command) {
    case 'open-tab-current-group':
      openTabCurrentGroup(tab);
      break;
    case 'open-tab-new-group':
      openTabNewGroup(tab);
      break;
    case 'move-tab-to-group':
      moveTabToGroup(tab);
      break;
    case 'rename-current-group':
      renameCurrentGroup(tab);
      break;
  }
});

async function ensureActiveTabsGroupedOnLaunch() {
  await ensureActiveTabsGrouped();
  queueEnsureActiveTabsGrouped();
}

function queueEnsureActiveTabsGrouped() {
  setTimeout(() => {
    ensureActiveTabsGrouped();
  }, 750);
}

async function ensureActiveTabsGrouped() {
  try {
    const windows = await api.windows.getAll({ populate: true, windowTypes: ['normal'] });
    for (const window of windows) {
      const activeTab = (window.tabs || []).find(tab => tab.active);
      if (!activeTab) continue;

      if (activeTab.groupId === -1) {
        const groupId = await api.tabs.group({ tabIds: activeTab.id });
        await promptToNameStartupGroup(window.id, activeTab.id, groupId);
        continue;
      }

      const group = await getTabGroupById(activeTab.groupId);
      if (group && !group.title) {
        await promptToNameStartupGroup(window.id, activeTab.id, activeTab.groupId);
      }
    }
  } catch (_) {}
}

async function getTabGroupById(groupId) {
  try {
    const groups = await api.tabGroups.query({});
    return groups.find(group => group.id === groupId) || null;
  } catch (_) {
    return null;
  }
}

async function promptToNameStartupGroup(windowId, tabId, groupId) {
  if (promptedStartupGroupIds.has(groupId)) return;
  promptedStartupGroupIds.add(groupId);

  try {
    await openDialog('name-group', {
      groupId,
      mode: 'create',
      sourceWindowId: windowId,
      focusTabId: tabId
    });
  } catch (_) {
    promptedStartupGroupIds.delete(groupId);
  }
}

async function openTabCurrentGroup(currentTab) {
  if (currentTab.groupId === -1) {
    api.tabs.create({ active: true });
    return;
  }
  const sameGroupTabs = await api.tabs.query({ currentWindow: true, groupId: currentTab.groupId });
  const lastIndex = sameGroupTabs[sameGroupTabs.length - 1].index;
  const newTab = await api.tabs.create({ active: true, index: lastIndex + 1 });
  await api.tabs.group({ tabIds: newTab.id, groupId: currentTab.groupId });
}

async function openTabNewGroup(currentTab) {
  const newTab = await api.tabs.create({ active: true });
  const groupId = await api.tabs.group({ tabIds: newTab.id });
  await openDialog('name-group', {
    groupId,
    mode: 'create',
    sourceWindowId: currentTab.windowId,
    focusTabId: newTab.id
  });
}

async function moveTabToGroup(currentTab) {
  const highlighted = await api.tabs.query({ highlighted: true, currentWindow: true });
  const tabIds = highlighted.map(t => t.id);
  await openDialog('move-tab', {
    tabIds: tabIds.join(','),
    windowId: currentTab.windowId,
    sourceWindowId: currentTab.windowId,
    focusTabId: currentTab.id
  });
}

async function renameCurrentGroup(currentTab) {
  if (currentTab.groupId === -1) return;
  try {
    const groups = await api.tabGroups.query({});
    const group = groups.find(g => g.id === currentTab.groupId);
    await openDialog('name-group', {
      groupId: currentTab.groupId,
      existingTitle: group ? group.title : '',
      mode: 'rename',
      sourceWindowId: currentTab.windowId,
      focusTabId: currentTab.id
    });
  } catch (_) {
    await openDialog('name-group', {
      groupId: currentTab.groupId,
      mode: 'rename',
      sourceWindowId: currentTab.windowId,
      focusTabId: currentTab.id
    });
  }
}

async function openDialog(action, params) {
  const url = new URL(api.runtime.getURL('src/dialog.html'));
  url.searchParams.set('action', action);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, String(value));
  }

  const width = action === 'move-tab' ? 420 : 360;
  const height = action === 'move-tab' ? 520 : 220;
  const createOptions = {
    url: url.toString(),
    type: 'popup',
    width,
    height,
    focused: true
  };

  try {
    const sourceWindowId = parseInt(params.sourceWindowId, 10);
    const currentWindow = Number.isNaN(sourceWindowId)
      ? await api.windows.getCurrent()
      : await api.windows.get(sourceWindowId);

    if (typeof currentWindow.left === 'number' && typeof currentWindow.top === 'number') {
      createOptions.left = Math.max(currentWindow.left + Math.round(((currentWindow.width || width) - width) / 2), 0);
      createOptions.top = Math.max(currentWindow.top + Math.round(((currentWindow.height || height) - height) / 2), 0);
    }
  } catch (_) {}

  await api.windows.create(createOptions);
}
