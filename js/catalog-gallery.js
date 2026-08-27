const React = window.React;
const ReactDOM = window.ReactDOM;

const mount = document.getElementById('circularCatalog');
const filters = document.getElementById('filters');

const STATIC_LIGHTING_PRODUCTS = [
  {
    id: 'pendente-escultural-madeira',
    image: './assets/produtos/pendente-escultural-madeira.webp',
    text: 'Pendente Escultural de Madeira',
    category: 'pendente',
    categoryLabel: 'Pendente',
    description: 'Pendente de madeira com composição escultural e presença marcante. Ideal para quem busca uma peça decorativa que também funcione como ponto de luz.',
    detailNote: 'Cores, dimensões e disponibilidade devem ser confirmadas com a equipe do Lojão Veras.',
    optionGroups: []
  },
  {
    id: 'pendente-organico-madeira',
    image: './assets/produtos/pendente-organico-madeira.webp',
    text: 'Pendente Orgânico de Madeira',
    category: 'pendente',
    categoryLabel: 'Pendente',
    description: 'Modelo de madeira com linhas orgânicas e visual leve, pensado para compor ambientes acolhedores e projetos com materiais naturais.',
    detailNote: 'Cores, dimensões e disponibilidade devem ser confirmadas com a equipe do Lojão Veras.',
    optionGroups: []
  },
  {
    id: 'arandela-lanterna-preta',
    image: './assets/produtos/arandela-lanterna-preta.webp',
    text: 'Arandela Lanterna Preta',
    category: 'arandela',
    categoryLabel: 'Arandela',
    description: 'Arandela em formato de lanterna com acabamento preto e linguagem clássica, indicada para criar pontos de iluminação decorativa em paredes.',
    detailNote: 'Dimensões, acabamento e disponibilidade devem ser confirmados com a equipe do Lojão Veras.',
    optionGroups: []
  },
  {
    id: 'pendente-aramado-preto',
    image: './assets/produtos/pendente-aramado-preto.webp',
    text: 'Pendente Aramado Preto',
    category: 'pendente',
    categoryLabel: 'Pendente',
    description: 'Pendente com estrutura aramada preta e desenho contemporâneo, valorizando a lâmpada e trazendo leveza visual à composição.',
    detailNote: 'Cores, dimensões e disponibilidade devem ser confirmadas com a equipe do Lojão Veras.',
    optionGroups: []
  },
  {
    id: 'pendente-cupula-madeira',
    image: './assets/produtos/pendente-cupula-madeira.webp',
    text: 'Pendente Cúpula de Madeira',
    category: 'pendente',
    categoryLabel: 'Pendente',
    description: 'Pendente com cúpula em madeira e desenho limpo, combinando iluminação funcional com acabamento de aspecto natural.',
    detailNote: 'Cores, dimensões e disponibilidade devem ser confirmadas com a equipe do Lojão Veras.',
    optionGroups: []
  }
];

let products = [...STATIC_LIGHTING_PRODUCTS];
let activeFilter = 'todos';
let CircularGallery = null;
let componentPromise = null;
let liveRoot = null;
let renderToken = 0;

const preloadedRemoteLighting = window.LVProductStore?.products?.filter?.(product => product.catalog_type === 'lighting');
if (Array.isArray(preloadedRemoteLighting) && preloadedRemoteLighting.length) {
  products = preloadedRemoteLighting.map(normalizeRemoteProduct);
}

function normalizeRemoteProduct(product) {
  return {
    id: product.slug || product.id,
    image: product.image_url || '',
    text: product.name,
    category: product.category,
    categoryLabel: product.category_label || product.category,
    description: product.description || '',
    detailNote: product.detail_note || '',
    optionGroups: Array.isArray(product.properties) ? product.properties : []
  };
}

function visibleProducts(filter) {
  return filter === 'todos' ? products : products.filter(product => product.category === filter);
}

function openProduct(product) {
  if (!product) return;
  window.dispatchEvent(new CustomEvent('lv:open-product', {
    detail: {
      ...product,
      name: product.text,
      source: 'luminaria',
      optionGroups: product.optionGroups || []
    }
  }));
}

function emptyElement() {
  return React.createElement(
    'div',
    { className: 'catalog-empty', role: 'status' },
    React.createElement('div', null,
      React.createElement('span', { className: 'catalog-empty-kicker' }, 'Catálogo em atualização'),
      React.createElement('strong', null, 'Novas fotos serão adicionadas em breve.'),
      React.createElement('p', null, 'Enquanto isso, consulte os modelos disponíveis diretamente na loja ou pelo WhatsApp.')
    )
  );
}

function ensureRoot() {
  if (!React || !ReactDOM || typeof ReactDOM.createRoot !== 'function') return null;
  if (!liveRoot) {
    mount.innerHTML = '';
    liveRoot = ReactDOM.createRoot(mount);
  }
  return liveRoot;
}

function renderEmpty() {
  if (React && ReactDOM && typeof ReactDOM.createRoot === 'function') {
    ensureRoot()?.render(emptyElement());
    return;
  }

  mount.innerHTML = `
    <div class="catalog-empty" role="status">
      <div>
        <span class="catalog-empty-kicker">Catálogo em atualização</span>
        <strong>Novas fotos serão adicionadas em breve.</strong>
        <p>Enquanto isso, consulte os modelos disponíveis diretamente na loja ou pelo WhatsApp.</p>
      </div>
    </div>`;
}

function renderStaticFallback(items) {
  if (liveRoot) {
    liveRoot.unmount();
    liveRoot = null;
  }

  mount.innerHTML = `
    <div class="circular-gallery-fallback-list" role="list" aria-label="Catálogo de luminárias">
      ${items.map(item => `
        <button class="circular-gallery-fallback-card" type="button" role="listitem" data-catalog-product-id="${item.id}" aria-label="Ver detalhes de ${item.text}">
          <img src="${item.image}" alt="${item.text}" loading="lazy" />
          <span>${item.text}</span>
        </button>`).join('')}
    </div>`;
}

async function ensureComponent() {
  if (CircularGallery) return CircularGallery;
  if (!React || !ReactDOM) throw new Error('React ou ReactDOM não estão disponíveis.');

  if (!componentPromise) {
    componentPromise = import('./CircularGallery.js').then(module => {
      CircularGallery = module.default;
      return CircularGallery;
    });
  }

  return componentPromise;
}

async function safeRender(filter = activeFilter) {
  activeFilter = filter;
  const token = ++renderToken;
  const visible = visibleProducts(filter);

  if (!visible.length) {
    renderEmpty();
    return;
  }

  if (!React || !ReactDOM) {
    renderStaticFallback(visible);
    return;
  }

  if (!liveRoot) {
    mount.innerHTML = '<div class="circular-catalog-fallback">Carregando catálogo…</div>';
  }

  try {
    const Gallery = await ensureComponent();
    if (token !== renderToken) return;

    const galleryProps = {
      items: visible,
      bend: 0,
      textColor: '#0d2340',
      borderRadius: 0.055,
      font: '500 30px Jost',
      scrollSpeed: 1.45,
      scrollEase: 0.065,
      onSelect: openProduct,
      autoPlay: true,
      autoPlaySpeed: 0.0045,
      autoPlayResumeDelay: 2600
    };

    if (typeof ReactDOM.createRoot === 'function') {
      ensureRoot()?.render(React.createElement(Gallery, galleryProps));
    } else {
      ReactDOM.render(React.createElement(Gallery, galleryProps), mount);
    }
  } catch (error) {
    console.error('Catálogo: falha ao iniciar CircularGallery. Usando versão alternativa.', error);
    if (token === renderToken) renderStaticFallback(visible);
  }
}

if (mount && filters) {
  mount.addEventListener('click', event => {
    const fallbackCard = event.target.closest('[data-catalog-product-id]');
    if (!fallbackCard) return;
    openProduct(products.find(product => product.id === fallbackCard.dataset.catalogProductId));
  });

  filters.addEventListener('click', event => {
    const button = event.target.closest('.filter');
    if (!button) return;

    filters.querySelectorAll('.filter').forEach(item => {
      const active = item === button;
      item.classList.toggle('active', active);
      item.setAttribute('aria-pressed', String(active));
    });

    safeRender(button.dataset.filter || 'todos');
  });

  window.addEventListener('lv:catalog-data', event => {
    const remote = event.detail?.lighting;
    if (!Array.isArray(remote) || !remote.length) return;
    products = remote.map(normalizeRemoteProduct);
    safeRender(activeFilter);
  });

  safeRender('todos');
}
