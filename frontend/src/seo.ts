export const SITE = {
  name: 'Aura Watch AI',
  url: 'https://aura-watch.adboardtools.com',
  title: 'Aura Watch AI — Multi-Camera Live Monitoring & Ask Camera AI',
  description:
    'Monitor every camera feed in real time from one dashboard, get proactive AI alerts, and ask questions about your footage in plain English—with cited clips as proof.',
  ogImage: '/screenshots/dashboard-archive.png',
  twitterHandle: '',
} as const;

export function absoluteUrl(path: string): string {
  return path.startsWith('http') ? path : `${SITE.url}${path.startsWith('/') ? path : `/${path}`}`;
}

export function landingStructuredData() {
  return [
    {
      '@context': 'https://schema.org',
      '@type': 'SoftwareApplication',
      name: SITE.name,
      applicationCategory: 'SecurityApplication',
      operatingSystem: 'Web, Linux, macOS',
      description: SITE.description,
      url: SITE.url,
      image: absoluteUrl(SITE.ogImage),
      featureList: [
        'Multi-camera live monitoring',
        'Ask Camera AI natural language search',
        'Motion-triggered clip recording',
        'On-device person and vehicle detection',
        'Cross-camera tracking',
      ],
      offers: {
        '@type': 'Offer',
        price: '0',
        priceCurrency: 'USD',
      },
    },
    {
      '@context': 'https://schema.org',
      '@type': 'Organization',
      name: SITE.name,
      url: SITE.url,
      logo: absoluteUrl('/favicon.svg'),
      contactPoint: {
        '@type': 'ContactPoint',
        contactType: 'sales',
        email: 'ankur.kus1@gmail.com',
        telephone: '+91-8587083895',
      },
    },
    {
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      name: SITE.name,
      url: SITE.url,
      description: SITE.description,
    },
  ];
}

export function injectStructuredData(data: unknown[]): () => void {
  const script = document.createElement('script');
  script.type = 'application/ld+json';
  script.dataset.seo = 'landing';
  script.textContent = JSON.stringify(data);
  document.head.appendChild(script);
  return () => {
    script.remove();
  };
}
