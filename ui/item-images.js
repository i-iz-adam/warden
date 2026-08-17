/*
 * Item image system (client side).
 *
 * Images are served by the central server at
 *   GET /items/image/{item name}.png
 * from Warden\server\data\item_sprites\, keyed by the exact in-game
 * item name -- e.g. "Armadyl godsword (or)" -> "Armadyl godsword (or).png".
 *
 * The actual download + on-disk caching happens Python-side
 * (Api.get_item_image in main.py, cached under the user's Warden data
 * dir at cache\item_sprites\). This file is just the browser-side
 * layer on top of that: an in-memory cache so a name already resolved
 * this session never round-trips through pywebview again, dedup of
 * in-flight requests so rendering the same item in five places at
 * once only triggers one lookup, and a small helper to drop an <img>
 * into HTML now and fill its real src in once the lookup resolves.
 */
const ItemImages = (() => {
    const FALLBACK_SRC =
        'data:image/svg+xml;utf8,' + encodeURIComponent(
            '<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28">' +
            '<rect width="28" height="28" rx="4" fill="#1a1d24"/>' +
            '<rect x="0.5" y="0.5" width="27" height="27" rx="4" fill="none" stroke="#2a2e38"/>' +
            '</svg>'
        );

    const resolved = new Map();   // item name -> data URI (or FALLBACK_SRC on failure)
    const inFlight = new Map();   // item name -> Promise<string>

    function fetchDataUri(name) {
        if (resolved.has(name)) return Promise.resolve(resolved.get(name));
        if (inFlight.has(name)) return inFlight.get(name);

        const api = window.pywebview && window.pywebview.api;
        if (!api || typeof api.get_item_image !== 'function') {
            return Promise.resolve(FALLBACK_SRC);
        }

        const p = api.get_item_image(name)
            .then(res => {
                const uri = (res && res.ok && res.data_uri) ? res.data_uri : FALLBACK_SRC;
                resolved.set(name, uri);
                inFlight.delete(name);
                return uri;
            })
            .catch(() => {
                inFlight.delete(name);
                // Don't cache network failures as permanent -- the server
                // might just be offline right now, worth retrying later.
                return FALLBACK_SRC;
            });

        inFlight.set(name, p);
        return p;
    }

    let _uid = 0;
    /** Returns an <img> tag string for `name`, sized `size`px square.
     *  Starts on a neutral placeholder and swaps to the real sprite
     *  once resolved (fire-and-forget -- safe to call even if the
     *  element ends up removed from the DOM before it resolves). */
    function icon(name, size) {
        size = size || 28;
        if (!name) return `<span class="item-icon item-icon-empty" style="width:${size}px;height:${size}px;"></span>`;
        const id = `itemimg-${++_uid}-${Date.now().toString(36)}`;
        fetchDataUri(name).then(uri => {
            const el = document.getElementById(id);
            if (el) el.src = uri;
        });
        return `<img id="${id}" class="item-icon" width="${size}" height="${size}" src="${FALLBACK_SRC}" alt="${escapeHtmlAttr(name)}" title="${escapeHtmlAttr(name)}">`;
    }

    /** Apply the icon directly to an existing <img> element -- handy
     *  when you already have a DOM node instead of building HTML. */
    function apply(imgEl, name) {
        if (!imgEl || !name) return;
        imgEl.src = FALLBACK_SRC;
        imgEl.alt = name;
        imgEl.title = name;
        fetchDataUri(name).then(uri => { imgEl.src = uri; });
    }

    function escapeHtmlAttr(s) {
        return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
    }

    return { icon, apply, fetchDataUri, FALLBACK_SRC };
})();
