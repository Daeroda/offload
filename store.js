// Data layer. v1 keeps data in this browser only (localStorage).
// Same interface will be backed by the server DB in the next step.
const Store = (() => {
  const KEY = 'offload.tasks.v1';

  function load() {
    try { return JSON.parse(localStorage.getItem(KEY)) || []; }
    catch { return []; }
  }
  function save(tasks) {
    try { localStorage.setItem(KEY, JSON.stringify(tasks)); } catch {}
  }

  return {
    list() { return load(); },
    add(task) {
      const tasks = load();
      tasks.push(task);
      save(tasks);
      return task;
    },
    update(id, patch) {
      const tasks = load().map(t => (t.id === id ? { ...t, ...patch } : t));
      save(tasks);
    },
    remove(id) { save(load().filter(t => t.id !== id)); },
  };
})();
