/* webgame-template admin SPA (vanilla JS, no build step). */
(function () {
  'use strict';

  // -------------------------------------------------------------------------
  // API client
  // -------------------------------------------------------------------------
  var api = {
    async req(path, init) {
      init = init || {};
      var headers = Object.assign({}, init.headers || {});
      if (init.method && init.method !== 'GET') headers['X-CSRF-Token'] = '1';
      if (init.body && !(init.body instanceof FormData) && typeof init.body !== 'string' && !(init.body instanceof ArrayBuffer)) {
        headers['Content-Type'] = 'application/json';
        init.body = JSON.stringify(init.body);
      }
      var res = await fetch('/admin/api' + path, Object.assign({}, init, { headers: headers, credentials: 'same-origin' }));
      if (res.status === 401) {
        location.href = '/admin';
        throw new Error('unauthorized');
      }
      if (!res.ok) {
        var msg = await res.text().catch(function () { return ''; });
        throw new Error(res.status + ' ' + msg);
      }
      return res.json();
    },
    getSite() { return this.req('/site'); },
    saveSite(site) { return this.req('/site', { method: 'PUT', body: site }); },
    getIndex() { return this.req('/index'); },
    getPage(type, lang, slug) { return this.req('/page/' + type + '/' + lang + '/' + encodeURIComponent(slug)); },
    savePage(page) { return this.req('/page', { method: 'PUT', body: page }); },
    deletePage(type, lang, slug) { return this.req('/page/' + type + '/' + lang + '/' + encodeURIComponent(slug), { method: 'DELETE' }); },
    async uploadImage(file) {
      var t = await this.req('/upload-token', { method: 'POST', body: { filename: file.name, contentType: file.type } });
      var res = await fetch('/admin/api/upload?token=' + encodeURIComponent(t.token), {
        method: 'PUT',
        headers: { 'Content-Type': file.type, 'X-CSRF-Token': '1' },
        body: file,
        credentials: 'same-origin',
      });
      if (!res.ok) throw new Error('upload failed: ' + res.status);
      return res.json();
    },
  };

  // -------------------------------------------------------------------------
  // tiny DOM helper
  // -------------------------------------------------------------------------
  function h(tag, attrs, children) {
    var el = document.createElement(tag);
    if (attrs) {
      for (var k in attrs) {
        if (k === 'class') el.className = attrs[k];
        else if (k === 'style' && typeof attrs[k] === 'object') Object.assign(el.style, attrs[k]);
        else if (k.startsWith('on') && typeof attrs[k] === 'function') el.addEventListener(k.slice(2).toLowerCase(), attrs[k]);
        else if (k === 'html') el.innerHTML = attrs[k];
        else if (attrs[k] !== undefined && attrs[k] !== null && attrs[k] !== false) el.setAttribute(k, attrs[k]);
      }
    }
    if (children !== undefined && children !== null) {
      var arr = Array.isArray(children) ? children : [children];
      arr.forEach(function (c) {
        if (c === null || c === undefined || c === false) return;
        if (typeof c === 'string' || typeof c === 'number') el.appendChild(document.createTextNode(String(c)));
        else el.appendChild(c);
      });
    }
    return el;
  }

  // Toast / status
  var toastEl;
  function toast(msg, kind) {
    if (!toastEl) {
      toastEl = h('div', { class: 'fixed top-4 right-4 z-50 max-w-sm space-y-2' });
      document.body.appendChild(toastEl);
    }
    var cls = 'card px-4 py-2 text-sm shadow-lg ' + (kind === 'err' ? 'border-rose-300 text-rose-700 bg-rose-50' : 'border-emerald-300 text-emerald-700 bg-emerald-50');
    var n = h('div', { class: cls }, msg);
    toastEl.appendChild(n);
    setTimeout(function () { n.remove(); }, 3500);
  }

  // -------------------------------------------------------------------------
  // App shell
  // -------------------------------------------------------------------------
  var root = document.getElementById('app');
  var state = {
    route: { name: 'pages' },
    site: null,
    index: null,
    editing: null,        // current PageDetail being edited
    editingOriginalKey: null, // for renames: original "type/lang/slug"
    dirty: false,
  };

  function render() {
    var view;
    if (state.route.name === 'pages') view = viewPages();
    else if (state.route.name === 'edit') view = viewEdit();
    else if (state.route.name === 'site') view = viewSite();
    else view = viewPages();
    root.replaceChildren(layout(view));
  }

  function layout(content) {
    return h('div', { class: 'min-h-screen flex flex-col' }, [
      h('header', { class: 'border-b border-slate-200 bg-white' }, [
        h('div', { class: 'mx-auto max-w-7xl px-4 py-3 flex items-center gap-4' }, [
          h('div', { class: 'flex items-center gap-2 font-semibold' }, [
            h('span', { class: 'inline-block h-6 w-6 rounded-md bg-brand-600' }),
            'webgame-template admin',
          ]),
          h('nav', { class: 'flex items-center gap-1 ml-4' }, [
            navBtn('Pages', state.route.name === 'pages' || state.route.name === 'edit', function () { go({ name: 'pages' }); }),
            navBtn('Site Settings', state.route.name === 'site', function () { go({ name: 'site' }); }),
          ]),
          h('div', { class: 'ml-auto flex items-center gap-2' }, [
            h('a', { href: '/', target: '_blank', class: 'btn-ghost' }, 'View site →'),
            h('a', { href: '/admin/logout', class: 'btn-ghost' }, 'Sign out'),
          ]),
        ]),
      ]),
      h('main', { class: 'flex-1' }, content),
    ]);
  }

  function navBtn(label, active, onClick) {
    return h('button', {
      class: 'btn ' + (active ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-100'),
      onClick: onClick,
    }, label);
  }

  function go(route) {
    if (state.dirty && state.route.name === 'edit') {
      if (!confirm('You have unsaved changes. Discard them?')) return;
      state.dirty = false;
    }
    state.route = route;
    render();
  }

  // -------------------------------------------------------------------------
  // View: Pages list
  // -------------------------------------------------------------------------
  function viewPages() {
    var container = h('div', { class: 'mx-auto max-w-7xl px-4 py-6 space-y-4' });
    container.appendChild(h('div', { class: 'flex items-center gap-3' }, [
      h('h1', { class: 'text-xl font-semibold' }, 'Pages'),
      h('div', { class: 'ml-auto flex gap-2' }, [
        newPageDropdown(),
      ]),
    ]));

    var list = h('div', { class: 'card divide-y divide-slate-100' });
    container.appendChild(list);
    list.appendChild(h('div', { class: 'px-4 py-6 text-sm text-slate-500' }, 'Loading…'));

    api.getIndex().then(function (idx) {
      state.index = idx;
      list.replaceChildren();
      var entries = (idx.entries || []).slice().sort(function (a, b) {
        return (a.updatedAt < b.updatedAt) ? 1 : -1;
      });
      if (entries.length === 0) {
        list.appendChild(h('div', { class: 'px-4 py-8 text-center text-sm text-slate-500' },
          'No pages yet. Use "New Page" to create your first page.'));
        return;
      }
      entries.forEach(function (e) {
        list.appendChild(pageRow(e));
      });
    }).catch(function (err) {
      list.replaceChildren(h('div', { class: 'px-4 py-6 text-sm text-rose-600' }, 'Failed to load: ' + err.message));
    });

    return container;
  }

  function newPageDropdown() {
    var btn = h('button', { class: 'btn-primary' }, '+ New Page');
    var menu = h('div', { class: 'absolute right-0 mt-1 hidden w-48 rounded-lg border border-slate-200 bg-white shadow-lg z-10' });
    ['game', 'guide', 'tag', 'home'].forEach(function (t) {
      menu.appendChild(h('button', {
        class: 'block w-full text-left px-3 py-2 hover:bg-slate-50 text-sm',
        onClick: function () { menu.classList.add('hidden'); newPage(t); },
      }, 'New ' + t + ' page'));
    });
    btn.addEventListener('click', function () { menu.classList.toggle('hidden'); });
    return h('div', { class: 'relative' }, [btn, menu]);
  }

  function pageRow(e) {
    return h('div', { class: 'flex items-center gap-4 px-4 py-3 hover:bg-slate-50' }, [
      h('div', { class: 'h-12 w-16 shrink-0 rounded bg-slate-100 overflow-hidden' }, [
        e.cover ? h('img', { src: e.cover, class: 'h-full w-full object-cover', loading: 'lazy' }) : null,
      ]),
      h('div', { class: 'min-w-0 flex-1' }, [
        h('div', { class: 'flex items-center gap-2' }, [
          h('div', { class: 'font-medium text-slate-900 truncate' }, e.title),
          h('span', { class: 'inline-block rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600' }, e.type),
          h('span', { class: 'inline-block rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600' }, e.lang),
        ]),
        h('div', { class: 'text-xs text-slate-500 truncate' }, '/' + (e.type === 'home' ? '' : (e.type === 'game' ? 'g' : e.type === 'guide' ? 'p' : 't') + '/') + e.slug + ' · updated ' + (e.updatedAt || '').slice(0, 10)),
      ]),
      h('button', { class: 'btn-ghost', onClick: function () { editPage(e.type, e.lang, e.slug); } }, 'Edit'),
      h('button', {
        class: 'btn-ghost text-rose-600 hover:bg-rose-50',
        onClick: function () {
          if (!confirm('Delete "' + e.title + '"? This commits to GitHub.')) return;
          api.deletePage(e.type, e.lang, e.slug)
            .then(function () { toast('Deleted'); render(); })
            .catch(function (err) { toast('Delete failed: ' + err.message, 'err'); });
        },
      }, 'Delete'),
    ]);
  }

  function newPage(type) {
    var lang = (state.site && state.site.defaultLang) || 'en';
    state.editing = {
      type: type,
      lang: lang,
      slug: type === 'home' ? 'home' : 'new-' + Math.random().toString(36).slice(2, 7),
      title: '',
      description: '',
      cover: '',
      tags: [],
      publishedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      alternateKey: '',
      modules: defaultModulesFor(type),
    };
    state.editingOriginalKey = null;
    state.dirty = true;
    go({ name: 'edit' });
  }

  function editPage(type, lang, slug) {
    state.editing = null;
    state.editingOriginalKey = type + '/' + lang + '/' + slug;
    go({ name: 'edit' });
    api.getPage(type, lang, slug).then(function (p) {
      p.tags = p.tags || [];
      p.modules = p.modules || [];
      state.editing = p;
      render();
    }).catch(function (err) { toast('Load failed: ' + err.message, 'err'); });
  }

  function defaultModulesFor(type) {
    if (type === 'game') {
      return [
        { type: 'game-iframe', url: '', ratio: '16:9' },
        { type: 'seo-content', variant: 'intro', heading: 'About', body: '' },
        { type: 'page-list', source: 'related', limit: 8 },
        { type: 'page-list', source: 'latest', limit: 12 },
      ];
    }
    if (type === 'guide') {
      return [
        { type: 'video-iframe', url: '', ratio: '16:9' },
        { type: 'seo-content', variant: 'intro', heading: '', body: '' },
        { type: 'page-list', source: 'related', limit: 8 },
      ];
    }
    if (type === 'tag') {
      return [
        { type: 'seo-content', variant: 'intro', heading: '', body: '' },
        { type: 'page-list', source: 'tag', limit: 24, layout: 'grid' },
        { type: 'seo-content', variant: 'faq', items: [] },
      ];
    }
    return [
      { type: 'page-list', source: 'latest', limit: 12, heading: 'Latest Games' },
      { type: 'seo-content', variant: 'intro', heading: 'Welcome', body: '' },
    ];
  }

  // -------------------------------------------------------------------------
  // View: Edit page
  // -------------------------------------------------------------------------
  function viewEdit() {
    var wrap = h('div', { class: 'mx-auto max-w-7xl px-4 py-6' });
    if (!state.editing) {
      wrap.appendChild(h('div', { class: 'text-sm text-slate-500' }, 'Loading…'));
      return wrap;
    }
    var p = state.editing;

    wrap.appendChild(h('div', { class: 'flex items-center gap-2 mb-4' }, [
      h('button', { class: 'btn-ghost', onClick: function () { go({ name: 'pages' }); } }, '← Back'),
      h('h1', { class: 'text-xl font-semibold' }, (state.editingOriginalKey ? 'Edit ' : 'New ') + p.type + ' page'),
      h('div', { class: 'ml-auto flex gap-2' }, [
        h('button', { class: 'btn-primary', onClick: savePage }, 'Save & Commit'),
      ]),
    ]));

    var grid = h('div', { class: 'grid lg:grid-cols-3 gap-6' });
    grid.appendChild(editMeta(p));
    grid.appendChild(editModules(p));
    wrap.appendChild(grid);
    return wrap;
  }

  function editMeta(p) {
    var col = h('div', { class: 'lg:col-span-1 space-y-4' });
    var card = h('div', { class: 'card p-4 space-y-3' });
    col.appendChild(card);

    card.appendChild(field('Type', h('select', {
      class: inputClass(),
      disabled: true,
    }, ['game', 'guide', 'tag', 'home'].map(function (t) {
      return h('option', { value: t, selected: t === p.type ? 'selected' : null }, t);
    }))));

    card.appendChild(field('Language', langSelect(p.lang, function (v) { p.lang = v; state.dirty = true; })));

    if (p.type !== 'home') {
      card.appendChild(field('Slug', input(p.slug, function (v) {
        p.slug = v.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
        state.dirty = true;
      }), 'used in the URL, e.g. /g/' + (p.slug || 'slug')));
    }

    card.appendChild(field('Title', input(p.title, function (v) { p.title = v; state.dirty = true; })));
    card.appendChild(field('Description', textarea(p.description || '', function (v) { p.description = v; state.dirty = true; }, 3)));

    card.appendChild(field('Cover image', imageInput(p.cover, function (v) { p.cover = v; state.dirty = true; })));

    card.appendChild(field('Tags', tagsInput(p.tags, function (v) { p.tags = v; state.dirty = true; })));

    if (p.type !== 'home') {
      card.appendChild(field('Alternate key', input(p.alternateKey || '', function (v) { p.alternateKey = v; state.dirty = true; }),
        'Pages sharing this key are translations of each other.'));
    }

    return col;
  }

  function editModules(p) {
    var col = h('div', { class: 'lg:col-span-2 space-y-4' });

    var header = h('div', { class: 'flex items-center gap-2' }, [
      h('h2', { class: 'font-semibold' }, 'Modules'),
      h('div', { class: 'ml-auto' }, addModuleDropdown(p)),
    ]);
    col.appendChild(header);

    if (!p.modules.length) {
      col.appendChild(h('div', { class: 'card p-6 text-center text-sm text-slate-500' },
        'No modules yet. Add modules to compose this page.'));
    }

    p.modules.forEach(function (m, idx) {
      col.appendChild(moduleCard(p, m, idx));
    });

    return col;
  }

  function addModuleDropdown(p) {
    var btn = h('button', { class: 'btn-primary' }, '+ Add module');
    var menu = h('div', { class: 'absolute right-0 mt-1 hidden w-56 rounded-lg border border-slate-200 bg-white shadow-lg z-10' });
    var options = [
      { label: 'Game iframe', mk: function () { return { type: 'game-iframe', url: '', ratio: '16:9' }; } },
      { label: 'Video iframe', mk: function () { return { type: 'video-iframe', url: '', ratio: '16:9' }; } },
      { label: 'Page list', mk: function () { return { type: 'page-list', source: 'latest', limit: 12 }; } },
      { label: 'SEO: intro', mk: function () { return { type: 'seo-content', variant: 'intro', heading: '', body: '' }; } },
      { label: 'SEO: rich text', mk: function () { return { type: 'seo-content', variant: 'rich-text', body: '' }; } },
      { label: 'SEO: features grid', mk: function () { return { type: 'seo-content', variant: 'features-grid', heading: '', items: [] }; } },
      { label: 'SEO: steps', mk: function () { return { type: 'seo-content', variant: 'steps', heading: '', items: [] }; } },
      { label: 'SEO: screenshots', mk: function () { return { type: 'seo-content', variant: 'screenshots', heading: '', images: [] }; } },
      { label: 'SEO: pros / cons', mk: function () { return { type: 'seo-content', variant: 'pros-cons', heading: '', pros: [], cons: [] }; } },
      { label: 'SEO: FAQ', mk: function () { return { type: 'seo-content', variant: 'faq', heading: '', items: [] }; } },
      { label: 'SEO: text + image', mk: function () { return { type: 'seo-content', variant: 'text-image', heading: '', body: '', image: { url: '', alt: '' } }; } },
    ];
    options.forEach(function (o) {
      menu.appendChild(h('button', {
        class: 'block w-full text-left px-3 py-2 hover:bg-slate-50 text-sm',
        onClick: function () { menu.classList.add('hidden'); p.modules.push(o.mk()); state.dirty = true; render(); },
      }, o.label));
    });
    btn.addEventListener('click', function () { menu.classList.toggle('hidden'); });
    return h('div', { class: 'relative inline-block' }, [btn, menu]);
  }

  function moduleCard(p, m, idx) {
    var card = h('div', { class: 'card p-4 space-y-3' });
    card.appendChild(h('div', { class: 'flex items-center gap-2' }, [
      h('div', { class: 'font-medium' }, moduleLabel(m)),
      h('div', { class: 'ml-auto flex items-center gap-1' }, [
        h('button', { class: 'btn-ghost text-xs', title: 'Move up', onClick: function () { move(p, idx, -1); } }, '↑'),
        h('button', { class: 'btn-ghost text-xs', title: 'Move down', onClick: function () { move(p, idx, +1); } }, '↓'),
        h('button', { class: 'btn-ghost text-xs text-rose-600 hover:bg-rose-50', onClick: function () {
          if (!confirm('Remove this module?')) return;
          p.modules.splice(idx, 1); state.dirty = true; render();
        } }, 'Remove'),
      ]),
    ]));
    card.appendChild(renderModuleEditor(m));
    return card;
  }

  function move(p, idx, delta) {
    var to = idx + delta;
    if (to < 0 || to >= p.modules.length) return;
    var x = p.modules[idx]; p.modules[idx] = p.modules[to]; p.modules[to] = x;
    state.dirty = true; render();
  }

  function moduleLabel(m) {
    if (m.type === 'seo-content') return 'SEO · ' + m.variant;
    return m.type;
  }

  function renderModuleEditor(m) {
    if (m.type === 'game-iframe' || m.type === 'video-iframe') {
      return h('div', { class: 'space-y-3' }, [
        field('Iframe URL', input(m.url, function (v) { m.url = v; state.dirty = true; }),
          m.type === 'video-iframe' ? 'YouTube embed URL (https://www.youtube.com/embed/...)' : 'Full iframe URL of the game.'),
        field('Aspect ratio', select(m.ratio || '16:9', ['16:9', '4:3', '1:1', '9:16'], function (v) { m.ratio = v; state.dirty = true; })),
        field('Cover image (optional)', imageInput(m.cover || '', function (v) { m.cover = v; state.dirty = true; })),
      ]);
    }
    if (m.type === 'page-list') {
      return h('div', { class: 'space-y-3' }, [
        field('Heading', input(m.heading || '', function (v) { m.heading = v; state.dirty = true; })),
        field('Source', select(m.source, ['latest', 'related', 'tag', 'manual'], function (v) { m.source = v; state.dirty = true; render(); })),
        m.source === 'tag' ? field('Tag', input((m.filter && m.filter.tag) || '', function (v) { m.filter = m.filter || {}; m.filter.tag = v; state.dirty = true; })) : null,
        field('Filter type', select((m.filter && m.filter.type) || '', ['', 'game', 'guide', 'tag'], function (v) {
          m.filter = m.filter || {};
          if (v) m.filter.type = v; else delete m.filter.type;
          state.dirty = true;
        })),
        field('Limit', input(String(m.limit || 12), function (v) { m.limit = parseInt(v, 10) || 12; state.dirty = true; })),
        field('Layout', select(m.layout || 'grid', ['grid', 'list', 'carousel'], function (v) { m.layout = v; state.dirty = true; })),
      ]);
    }
    if (m.type === 'seo-content') {
      return seoEditor(m);
    }
    return h('div', { class: 'text-sm text-slate-500' }, 'Unknown module');
  }

  function seoEditor(m) {
    var parts = [];
    if (m.variant !== 'rich-text' && m.variant !== 'pros-cons' && m.variant !== 'screenshots' && m.variant !== 'faq' && m.variant !== 'features-grid' && m.variant !== 'steps' && m.variant !== 'text-image') {
      parts.push(field('Heading', input(m.heading || '', function (v) { m.heading = v; state.dirty = true; })));
    } else if (m.variant === 'pros-cons' || m.variant === 'screenshots' || m.variant === 'faq' || m.variant === 'features-grid' || m.variant === 'steps' || m.variant === 'text-image') {
      parts.push(field('Heading', input(m.heading || '', function (v) { m.heading = v; state.dirty = true; })));
    }

    if (m.variant === 'intro' || m.variant === 'rich-text') {
      parts.push(field('Body (Markdown)', textarea(m.body || '', function (v) { m.body = v; state.dirty = true; }, 8)));
    }
    if (m.variant === 'features-grid' || m.variant === 'steps') {
      parts.push(field('Intro', textarea(m.intro || '', function (v) { m.intro = v; state.dirty = true; }, 2)));
      parts.push(itemListEditor(m.items, ['title', 'body'].concat(m.variant === 'features-grid' ? ['icon'] : []),
        function (next) { m.items = next; state.dirty = true; }, 'Items'));
    }
    if (m.variant === 'screenshots') {
      parts.push(imageListEditor(m.images, function (next) { m.images = next; state.dirty = true; }));
    }
    if (m.variant === 'pros-cons') {
      parts.push(field('Pros (one per line)', textarea(m.pros.join('\n'), function (v) { m.pros = v.split('\n').map(function (x) { return x.trim(); }).filter(Boolean); state.dirty = true; }, 4)));
      parts.push(field('Cons (one per line)', textarea(m.cons.join('\n'), function (v) { m.cons = v.split('\n').map(function (x) { return x.trim(); }).filter(Boolean); state.dirty = true; }, 4)));
    }
    if (m.variant === 'faq') {
      parts.push(itemListEditor(m.items, ['q', 'a'], function (next) { m.items = next; state.dirty = true; }, 'Q & A'));
    }
    if (m.variant === 'text-image') {
      parts.push(field('Body (Markdown)', textarea(m.body || '', function (v) { m.body = v; state.dirty = true; }, 6)));
      parts.push(field('Image', imageInput((m.image && m.image.url) || '', function (v) { m.image = m.image || { url: '', alt: '' }; m.image.url = v; state.dirty = true; })));
      parts.push(field('Image alt', input((m.image && m.image.alt) || '', function (v) { m.image = m.image || { url: '', alt: '' }; m.image.alt = v; state.dirty = true; })));
      parts.push(field('Reverse layout', checkbox(!!m.reverse, function (v) { m.reverse = v; state.dirty = true; })));
    }
    return h('div', { class: 'space-y-3' }, parts);
  }

  function itemListEditor(items, fields, onChange, label) {
    var wrap = h('div', { class: 'space-y-2' });
    wrap.appendChild(h('div', { class: 'text-sm font-medium text-slate-700' }, label));
    items.forEach(function (it, i) {
      var row = h('div', { class: 'rounded-lg border border-slate-200 p-3 space-y-2' });
      fields.forEach(function (f) {
        row.appendChild(field(f, input(it[f] || '', function (v) { it[f] = v; onChange(items); })));
      });
      row.appendChild(h('button', { class: 'btn-ghost text-xs text-rose-600 hover:bg-rose-50', onClick: function () { items.splice(i, 1); onChange(items); render(); } }, 'Remove'));
      wrap.appendChild(row);
    });
    wrap.appendChild(h('button', { class: 'btn-ghost text-sm', onClick: function () {
      var empty = {}; fields.forEach(function (f) { empty[f] = ''; });
      items.push(empty); onChange(items); render();
    } }, '+ Add item'));
    return wrap;
  }

  function imageListEditor(images, onChange) {
    var wrap = h('div', { class: 'space-y-2' });
    wrap.appendChild(h('div', { class: 'text-sm font-medium text-slate-700' }, 'Images'));
    images.forEach(function (img, i) {
      var row = h('div', { class: 'rounded-lg border border-slate-200 p-3 space-y-2' });
      row.appendChild(field('Image', imageInput(img.url || '', function (v) { img.url = v; onChange(images); })));
      row.appendChild(field('Alt text', input(img.alt || '', function (v) { img.alt = v; onChange(images); })));
      row.appendChild(field('Caption', input(img.caption || '', function (v) { img.caption = v; onChange(images); })));
      row.appendChild(h('button', { class: 'btn-ghost text-xs text-rose-600 hover:bg-rose-50', onClick: function () { images.splice(i, 1); onChange(images); render(); } }, 'Remove'));
      wrap.appendChild(row);
    });
    wrap.appendChild(h('button', { class: 'btn-ghost text-sm', onClick: function () {
      images.push({ url: '', alt: '' }); onChange(images); render();
    } }, '+ Add image'));
    return wrap;
  }

  function savePage() {
    if (!state.editing) return;
    var p = state.editing;
    if (!p.title || !p.slug) { toast('Title and slug are required', 'err'); return; }
    var btn = event.target;
    var oldLabel = btn.textContent;
    btn.disabled = true; btn.textContent = 'Saving…';
    api.savePage(p).then(function () {
      state.dirty = false;
      toast('Saved. Cloudflare will redeploy in a few seconds.');
      go({ name: 'pages' });
    }).catch(function (err) {
      toast('Save failed: ' + err.message, 'err');
      btn.disabled = false; btn.textContent = oldLabel;
    });
  }

  // -------------------------------------------------------------------------
  // View: Site settings
  // -------------------------------------------------------------------------
  function viewSite() {
    var wrap = h('div', { class: 'mx-auto max-w-3xl px-4 py-6 space-y-4' });
    wrap.appendChild(h('h1', { class: 'text-xl font-semibold' }, 'Site Settings'));
    var loading = h('div', { class: 'card px-4 py-6 text-sm text-slate-500' }, 'Loading…');
    wrap.appendChild(loading);

    api.getSite().then(function (s) {
      state.site = s;
      wrap.replaceChildren(h('h1', { class: 'text-xl font-semibold' }, 'Site Settings'));

      var card = h('div', { class: 'card p-5 space-y-4' });
      card.appendChild(field('Site name', input(s.name, function (v) { s.name = v; })));
      card.appendChild(field('Site description', textarea(s.description, function (v) { s.description = v; }, 2)));
      card.appendChild(field('Default language', input(s.defaultLang, function (v) { s.defaultLang = v.trim(); }),
        'Code of the language served at the site root (e.g. "en").'));
      card.appendChild(languagesEditor(s));
      card.appendChild(adsenseEditor(s));
      card.appendChild(analyticsEditor(s));
      card.appendChild(menuEditor(s));
      card.appendChild(footerEditor(s));

      var actions = h('div', { class: 'flex gap-2' }, [
        h('button', { class: 'btn-primary', onClick: function () {
          api.saveSite(s).then(function () { toast('Saved'); }).catch(function (err) { toast('Save failed: ' + err.message, 'err'); });
        } }, 'Save & Commit'),
      ]);
      wrap.appendChild(card);
      wrap.appendChild(actions);
    }).catch(function (err) {
      loading.textContent = 'Failed: ' + err.message;
    });

    return wrap;
  }

  function languagesEditor(s) {
    var wrap = h('div', { class: 'space-y-2' });
    wrap.appendChild(h('div', { class: 'text-sm font-medium text-slate-700' }, 'Languages'));
    s.languages = s.languages || [];
    s.languages.forEach(function (l, i) {
      var row = h('div', { class: 'flex gap-2 items-center' });
      row.appendChild(input(l.code, function (v) { l.code = v.trim(); }, { placeholder: 'code (e.g. en)', class: inputClass() + ' w-24' }));
      row.appendChild(input(l.label, function (v) { l.label = v; }, { placeholder: 'label (English)', class: inputClass() + ' flex-1' }));
      row.appendChild(input(l.htmlLang, function (v) { l.htmlLang = v; }, { placeholder: 'html lang (en)', class: inputClass() + ' w-32' }));
      row.appendChild(h('button', { class: 'btn-ghost text-rose-600', onClick: function () { s.languages.splice(i, 1); render(); } }, '×'));
      wrap.appendChild(row);
    });
    wrap.appendChild(h('button', { class: 'btn-ghost text-sm', onClick: function () {
      s.languages.push({ code: '', label: '', htmlLang: '' }); render();
    } }, '+ Add language'));
    return wrap;
  }

  function adsenseEditor(s) {
    s.adsense = s.adsense || { clientId: '' };
    return field('AdSense client ID (auto ads)', input(s.adsense.clientId, function (v) {
      s.adsense.clientId = v.trim();
    }), 'e.g. ca-pub-1234567890123456. Leave empty to disable.');
  }

  function analyticsEditor(s) {
    s.analytics = s.analytics || {};
    return field('Google Analytics ID', input(s.analytics.googleAnalyticsId || '', function (v) {
      s.analytics.googleAnalyticsId = v.trim();
    }), 'e.g. G-XXXXXXX. Leave empty to disable.');
  }

  function menuEditor(s) {
    s.menu = s.menu || [];
    var wrap = h('div', { class: 'space-y-2' });
    wrap.appendChild(h('div', { class: 'text-sm font-medium text-slate-700' }, 'Header menu'));
    s.menu.forEach(function (item, i) {
      var row = h('div', { class: 'flex gap-2 items-center' });
      row.appendChild(input(item.lang, function (v) { item.lang = v.trim(); }, { placeholder: 'lang', class: inputClass() + ' w-20' }));
      row.appendChild(input(item.label, function (v) { item.label = v; }, { placeholder: 'label', class: inputClass() + ' flex-1' }));
      row.appendChild(input(item.url, function (v) { item.url = v; }, { placeholder: '/url', class: inputClass() + ' flex-1' }));
      row.appendChild(h('button', { class: 'btn-ghost text-rose-600', onClick: function () { s.menu.splice(i, 1); render(); } }, '×'));
      wrap.appendChild(row);
    });
    wrap.appendChild(h('button', { class: 'btn-ghost text-sm', onClick: function () {
      s.menu.push({ lang: s.defaultLang || 'en', label: '', url: '' }); render();
    } }, '+ Add menu item'));
    return wrap;
  }

  function footerEditor(s) {
    s.footer = s.footer || { copyright: '', links: [] };
    var wrap = h('div', { class: 'space-y-2' });
    wrap.appendChild(h('div', { class: 'text-sm font-medium text-slate-700' }, 'Footer'));
    wrap.appendChild(field('Copyright', input(s.footer.copyright || '', function (v) { s.footer.copyright = v; })));
    wrap.appendChild(h('div', { class: 'text-xs text-slate-500' }, 'Links'));
    s.footer.links.forEach(function (item, i) {
      var row = h('div', { class: 'flex gap-2 items-center' });
      row.appendChild(input(item.lang, function (v) { item.lang = v.trim(); }, { placeholder: 'lang', class: inputClass() + ' w-20' }));
      row.appendChild(input(item.label, function (v) { item.label = v; }, { placeholder: 'label', class: inputClass() + ' flex-1' }));
      row.appendChild(input(item.url, function (v) { item.url = v; }, { placeholder: '/url', class: inputClass() + ' flex-1' }));
      row.appendChild(h('button', { class: 'btn-ghost text-rose-600', onClick: function () { s.footer.links.splice(i, 1); render(); } }, '×'));
      wrap.appendChild(row);
    });
    wrap.appendChild(h('button', { class: 'btn-ghost text-sm', onClick: function () {
      s.footer.links.push({ lang: s.defaultLang || 'en', label: '', url: '' }); render();
    } }, '+ Add footer link'));
    return wrap;
  }

  // -------------------------------------------------------------------------
  // form widgets
  // -------------------------------------------------------------------------
  function inputClass() {
    return 'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-100';
  }

  function field(label, control, hint) {
    return h('label', { class: 'block' }, [
      h('div', { class: 'text-sm font-medium text-slate-700 mb-1' }, label),
      control,
      hint ? h('div', { class: 'text-xs text-slate-500 mt-1' }, hint) : null,
    ]);
  }

  function input(value, onChange, opts) {
    opts = opts || {};
    var el = h('input', Object.assign({ type: 'text', class: inputClass(), value: value || '' }, opts));
    el.addEventListener('input', function () { onChange(el.value); });
    return el;
  }

  function textarea(value, onChange, rows) {
    var el = h('textarea', { class: inputClass() + ' font-mono', rows: rows || 4 });
    el.value = value || '';
    el.addEventListener('input', function () { onChange(el.value); });
    return el;
  }

  function select(value, options, onChange) {
    var el = h('select', { class: inputClass() }, options.map(function (o) {
      return h('option', { value: o, selected: o === value ? 'selected' : null }, o || '(any)');
    }));
    el.addEventListener('change', function () { onChange(el.value); });
    return el;
  }

  function checkbox(value, onChange) {
    var el = h('input', { type: 'checkbox' });
    el.checked = !!value;
    el.addEventListener('change', function () { onChange(el.checked); });
    return el;
  }

  function langSelect(value, onChange) {
    if (!state.site) {
      api.getSite().then(function (s) { state.site = s; render(); });
      return h('div', { class: 'text-sm text-slate-500' }, 'Loading languages…');
    }
    return select(value, state.site.languages.map(function (l) { return l.code; }), onChange);
  }

  function tagsInput(value, onChange) {
    var v = (value || []).join(', ');
    return input(v, function (raw) {
      var tags = raw.split(',').map(function (x) { return x.trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, ''); }).filter(Boolean);
      onChange(tags);
    }, { placeholder: 'action, multiplayer, 2-player' });
  }

  function imageInput(value, onChange) {
    var wrap = h('div', { class: 'space-y-2' });
    var preview = h('div', { class: 'aspect-video w-full max-w-xs rounded-lg border border-slate-200 bg-slate-50 overflow-hidden flex items-center justify-center' });
    function refreshPreview(v) {
      preview.replaceChildren();
      if (v) preview.appendChild(h('img', { src: v, class: 'h-full w-full object-cover' }));
      else preview.appendChild(h('div', { class: 'text-xs text-slate-400' }, 'No image'));
    }
    refreshPreview(value);
    var url = input(value || '', function (v) { onChange(v); refreshPreview(v); }, { placeholder: 'https://... or upload below' });
    var fileInput = h('input', { type: 'file', accept: 'image/*', class: 'text-sm' });
    fileInput.addEventListener('change', function () {
      var f = fileInput.files && fileInput.files[0];
      if (!f) return;
      var btn = h('span'); // no actual button
      toast('Uploading…');
      api.uploadImage(f).then(function (r) {
        url.value = r.publicUrl;
        onChange(r.publicUrl);
        refreshPreview(r.publicUrl);
        toast('Uploaded');
      }).catch(function (err) { toast('Upload failed: ' + err.message, 'err'); });
    });
    wrap.appendChild(preview);
    wrap.appendChild(url);
    wrap.appendChild(fileInput);
    return wrap;
  }

  // -------------------------------------------------------------------------
  // boot
  // -------------------------------------------------------------------------
  api.getSite().then(function (s) { state.site = s; render(); }).catch(function () { render(); });
})();
