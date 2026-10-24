// 把編輯器的資料模型轉成 LINE Messaging API 的 JSON。瀏覽器與伺服器共用這支檔案。
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Builder = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const cut = (s, n) => String(s || '').slice(0, n);
  const splitTags = (t) => (Array.isArray(t) ? t : String(t || '').split(/[,，、\s]+/)).map((x) => x.trim()).filter(Boolean);

  // 動作的 postback data：k=統計用名稱、tag=要貼的標籤、reply=自動回覆文字、sw=切換到的選單層
  function postbackData(a, extra) {
    const p = new URLSearchParams();
    p.set('k', cut(a.key || a.label || a.text || '按鈕', 40));
    for (const t of splitTags(a.tags)) p.append('tag', t);
    if (a.reply) p.set('reply', cut(a.reply, 120));
    if (extra) for (const [k, v] of Object.entries(extra)) p.set(k, v);
    return cut(p.toString(), 290);
  }

  function shareUri(text) {
    return 'https://line.me/R/share?text=' + encodeURIComponent(text || '');
  }

  // where: flex | template | quick | imagemap | richmenu
  function toAction(a, where, ctx) {
    a = a || {};
    const label = cut(a.label || a.text || '按鈕', where === 'flex' ? 40 : 20);
    const track = { tags: splitTags(a.tags), key: cut(a.key || a.label || a.text || a.uri || '連結', 40) };
    switch (a.type) {
      case 'uri':
      case 'share': {
        const uri = a.type === 'share' ? shareUri(a.text) : String(a.uri || '').trim();
        if (a.type === 'share') track.key = cut(a.label || '分享', 40);
        if (where === 'imagemap') return { type: 'uri', linkUri: uri, _track: track };
        return { type: 'uri', label, uri, _track: track };
      }
      case 'message':
        if (where === 'imagemap') return { type: 'message', text: cut(a.text, 400) };
        return { type: 'message', label, text: cut(a.text || label, 300) };
      case 'tag': {
        const act = { type: 'postback', label, data: postbackData(a) };
        if (a.text) act.displayText = cut(a.text, 300);
        return act;
      }
      case 'switch': {
        const alias = ctx && ctx.aliases ? ctx.aliases[a.layer || 0] : 'layer-' + (a.layer || 0);
        return { type: 'richmenuswitch', label, richMenuAliasId: alias, data: postbackData(a, { sw: String(a.layer || 0) }) };
      }
      case 'camera':
      case 'cameraRoll':
      case 'location':
        return { type: a.type, label };
      default:
        return { type: 'message', label, text: label };
    }
  }

  const RATIO = { '20:13': '20:13', '1:1': '1:1', '16:9': '16:9', '3:4': '3:4', '1.51:1': '1.51:1' };

  function bubble(b) {
    const color = b.color || '#C07B84';
    const out = { type: 'bubble' };
    if (b.image) {
      out.hero = { type: 'image', url: b.image, size: 'full', aspectMode: 'cover', aspectRatio: RATIO[b.ratio] || '20:13' };
      if (b.imageAction && b.imageAction.type) out.hero.action = toAction(b.imageAction, 'flex');
    }
    const body = [];
    if (b.title) body.push({ type: 'text', text: cut(b.title, 200), weight: 'bold', size: 'xl', wrap: true });
    if (b.price) body.push({ type: 'text', text: cut(b.price, 60), size: 'lg', color, weight: 'bold', margin: 'md' });
    if (b.text) body.push({ type: 'text', text: cut(b.text, 1000), size: 'sm', color: '#666666', wrap: true, margin: 'md' });
    if (body.length) out.body = { type: 'box', layout: 'vertical', contents: body };
    const buttons = (b.buttons || []).filter((x) => x && x.type).slice(0, 4);
    if (buttons.length) {
      out.footer = {
        type: 'box', layout: 'vertical', spacing: 'sm',
        contents: buttons.map((x, i) => ({
          type: 'button', height: 'sm',
          style: i === 0 ? 'primary' : 'secondary',
          ...(i === 0 ? { color } : {}),
          action: toAction(x, 'flex'),
        })),
      };
    }
    if (!out.body && !out.hero) out.body = { type: 'box', layout: 'vertical', contents: [{ type: 'text', text: ' ' }] };
    return out;
  }

  function youtubeId(url) {
    const m = String(url || '').match(/(?:youtu\.be\/|v=|\/embed\/|\/shorts\/|\/live\/)([\w-]{11})/);
    return m ? m[1] : null;
  }

  function youtubeBubble(it) {
    const id = youtubeId(it.url);
    const watch = id ? `https://www.youtube.com/watch?v=${id}` : String(it.url || '');
    const thumb = id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : '';
    const play = { type: 'uri', label: '觀看影片', uri: watch, _track: { tags: splitTags(it.tags), key: cut(it.title || 'YouTube', 40) } };
    const hero = {
      type: 'box', layout: 'vertical', paddingAll: '0px', action: play,
      contents: [
        { type: 'image', url: thumb, size: 'full', aspectMode: 'cover', aspectRatio: '16:9' },
        {
          type: 'box', layout: 'vertical', position: 'absolute', offsetTop: '0px', offsetBottom: '0px', offsetStart: '0px', offsetEnd: '0px',
          justifyContent: 'center', alignItems: 'center',
          contents: [{
            type: 'box', layout: 'vertical', width: '64px', height: '44px', cornerRadius: '12px', backgroundColor: '#FF0000E6',
            justifyContent: 'center', alignItems: 'center',
            contents: [{ type: 'text', text: '▶', color: '#FFFFFF', size: 'xl', align: 'center' }],
          }],
        },
      ],
    };
    const body = [];
    if (it.title) body.push({ type: 'text', text: cut(it.title, 200), weight: 'bold', size: 'lg', wrap: true });
    if (it.desc) body.push({ type: 'text', text: cut(it.desc, 500), size: 'sm', color: '#666666', wrap: true, margin: 'sm' });
    const out = {
      type: 'bubble', hero,
      footer: { type: 'box', layout: 'vertical', contents: [{ type: 'button', style: 'primary', color: '#FF0000', height: 'sm', action: { ...play, label: cut(it.button || '▶ 觀看影片', 40) } }] },
    };
    if (body.length) out.body = { type: 'box', layout: 'vertical', contents: body };
    return out;
  }

  function buildItem(it, altText) {
    const alt = cut(it.altText || altText || '你有一則新訊息', 400);
    switch (it.type) {
      case 'text':
        return { type: 'text', text: cut(it.text || ' ', 5000) };
      case 'image':
        return { type: 'image', originalContentUrl: it.url, previewImageUrl: it.preview || it.url };
      case 'video':
        return { type: 'video', originalContentUrl: it.url, previewImageUrl: it.preview };
      case 'imagemap':
        return {
          type: 'imagemap', baseUrl: it.baseUrl, altText: alt,
          baseSize: { width: 1040, height: Math.round(it.height || 1040) },
          actions: (it.areas || []).map((ar) => ({
            ...toAction(ar.action, 'imagemap'),
            area: { x: Math.round(ar.x), y: Math.round(ar.y), width: Math.round(ar.w), height: Math.round(ar.h) },
          })),
        };
      case 'youtube':
        return { type: 'flex', altText: alt, contents: youtubeBubble(it) };
      case 'flex': {
        const bubbles = (it.bubbles || []).slice(0, 12).map(bubble);
        const contents = bubbles.length === 1 ? bubbles[0] : { type: 'carousel', contents: bubbles };
        return { type: 'flex', altText: alt, contents };
      }
      case 'flexjson': {
        let contents = it.json;
        if (typeof contents === 'string') contents = JSON.parse(contents);
        if (contents && contents.type === 'flex') return contents;
        return { type: 'flex', altText: alt, contents };
      }
      case 'buttons': {
        const t = { type: 'buttons', text: cut(it.text || ' ', it.image || it.title ? 60 : 160), actions: (it.actions || []).slice(0, 4).map((a) => toAction(a, 'template')) };
        if (it.image) t.thumbnailImageUrl = it.image;
        if (it.title) t.title = cut(it.title, 40);
        return { type: 'template', altText: alt, template: t };
      }
      case 'confirm':
        return { type: 'template', altText: alt, template: { type: 'confirm', text: cut(it.text || ' ', 240), actions: (it.actions || []).slice(0, 2).map((a) => toAction(a, 'template')) } };
      default:
        throw new Error('未知的訊息類型：' + it.type);
    }
  }

  // model = { altText, messages: [...], quickReply: [{ imageUrl, action }] }
  function buildMessages(model) {
    const msgs = (model.messages || []).slice(0, 5).map((m) => buildItem(m, model.altText));
    const qr = (model.quickReply || []).filter((q) => q.action && q.action.type).slice(0, 13);
    if (qr.length && msgs.length) {
      msgs[msgs.length - 1].quickReply = {
        items: qr.map((q) => ({ type: 'action', ...(q.imageUrl ? { imageUrl: q.imageUrl } : {}), action: toAction(q.action, 'quick') })),
      };
    }
    return msgs;
  }

  // 移除編輯器內部用的欄位（以 _ 開頭），得到可直接貼到 LINE API 的 JSON
  function clean(obj) {
    if (Array.isArray(obj)) return obj.map(clean);
    if (obj && typeof obj === 'object') {
      const o = {};
      for (const [k, v] of Object.entries(obj)) if (!k.startsWith('_')) o[k] = clean(v);
      return o;
    }
    return obj;
  }

  // menu = { name, size: 'large'|'compact', chatBarText, layers: [{ name, areas }] }
  function buildRichMenus(menu, aliases) {
    const height = menu.size === 'compact' ? 843 : 1686;
    return (menu.layers || []).map((layer, i) => ({
      size: { width: 2500, height },
      selected: !!menu.openByDefault,
      name: cut(`${menu.name || '選單'}-${layer.name || i + 1}`, 300),
      chatBarText: cut(menu.chatBarText || '選單', 14),
      areas: (layer.areas || []).map((ar) => ({
        bounds: { x: Math.round(ar.x), y: Math.round(ar.y), width: Math.round(ar.w), height: Math.round(ar.h) },
        action: toAction({ key: ar.action && ar.action.label ? undefined : `${layer.name || '第' + (i + 1) + '層'}-格${(layer.areas || []).indexOf(ar) + 1}`, ...ar.action }, 'richmenu', { aliases }),
      })),
    }));
  }

  return { buildMessages, buildItem, buildRichMenus, toAction, clean, youtubeId, splitTags };
});
