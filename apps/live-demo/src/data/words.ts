/*
 * The words the demo's data is made of. Invented companies and people: the
 * surnames, trades and towns are common ones, and no combination is meant to
 * name a real business. Plain lists, so a reader can see every value the
 * generator can write.
 */

export type Language = 'de' | 'fr' | 'it' | 'nl'

/** How a customer in one language region of a country is named: its towns and its legal forms. */
export interface Region {
  language: Language
  /** How often a customer of the country is from this region, against the country's other regions. */
  weight: number
  towns: readonly string[]
  /** The legal forms of the country written in this region's language; a name ends with one. */
  forms: readonly string[]
}

export interface CountryWords {
  isoCode: string
  name: string
  regions: readonly Region[]
  /** Who delivers to the country. */
  carriers: readonly string[]
}

/**
 * Every country a customer may be in. CH and DE are the fixture's own rows
 * (postgres.sql inserts them); the demo adds the rest.
 */
export const COUNTRIES: readonly CountryWords[] = [
  {
    isoCode: 'CH',
    name: 'Switzerland',
    regions: [
      { language: 'de', weight: 7, towns: ['Zürich', 'Basel', 'Bern', 'Luzern', 'Winterthur', 'St. Gallen', 'Zug', 'Aarau', 'Thun', 'Chur', 'Olten', 'Baden', 'Schaffhausen', 'Frauenfeld'], forms: ['AG', 'GmbH'] },
      { language: 'fr', weight: 2, towns: ['Lausanne', 'Genève', 'Fribourg', 'Neuchâtel', 'Sion', 'Yverdon'], forms: ['SA', 'Sàrl'] },
      { language: 'it', weight: 1, towns: ['Lugano', 'Bellinzona', 'Locarno', 'Mendrisio'], forms: ['SA'] },
    ],
    carriers: ['Swiss Post', 'Planzer', 'Galliker', 'DHL Express'],
  },
  {
    isoCode: 'DE',
    name: 'Germany',
    regions: [
      { language: 'de', weight: 1, towns: ['Hamburg', 'München', 'Köln', 'Stuttgart', 'Frankfurt', 'Leipzig', 'Dresden', 'Nürnberg', 'Hannover', 'Bremen', 'Augsburg', 'Mannheim', 'Karlsruhe', 'Dortmund', 'Bielefeld', 'Ulm'], forms: ['GmbH', 'AG', 'KG'] },
    ],
    carriers: ['DHL', 'DPD', 'Hermes', 'GLS', 'DB Schenker'],
  },
  {
    isoCode: 'AT',
    name: 'Austria',
    regions: [{ language: 'de', weight: 1, towns: ['Wien', 'Graz', 'Linz', 'Salzburg', 'Innsbruck', 'Klagenfurt', 'Villach', 'Wels', 'Dornbirn', 'Bregenz'], forms: ['GmbH', 'AG', 'OG'] }],
    carriers: ['Österreichische Post', 'DPD', 'GLS', 'Gebrüder Weiss'],
  },
  {
    isoCode: 'BE',
    name: 'Belgium',
    regions: [
      { language: 'nl', weight: 3, towns: ['Antwerpen', 'Gent', 'Brugge', 'Leuven', 'Mechelen', 'Hasselt', 'Kortrijk'], forms: ['BV'] },
      { language: 'fr', weight: 2, towns: ['Liège', 'Namur', 'Charleroi', 'Mons', 'Wavre'], forms: ['SRL'] },
    ],
    carriers: ['bpost', 'DPD', 'GLS'],
  },
  {
    isoCode: 'FR',
    name: 'France',
    regions: [{ language: 'fr', weight: 1, towns: ['Lyon', 'Lille', 'Strasbourg', 'Nantes', 'Bordeaux', 'Toulouse', 'Grenoble', 'Rennes', 'Dijon', 'Mulhouse', 'Annecy', 'Reims'], forms: ['SAS', 'SARL'] }],
    carriers: ['Colissimo', 'Chronopost', 'Geodis', 'DB Schenker'],
  },
  {
    isoCode: 'IT',
    name: 'Italy',
    regions: [{ language: 'it', weight: 1, towns: ['Milano', 'Torino', 'Bologna', 'Verona', 'Brescia', 'Bergamo', 'Como', 'Padova', 'Genova', 'Varese'], forms: ['S.r.l.', 'S.p.A.'] }],
    carriers: ['Poste Italiane', 'BRT', 'SDA', 'GLS'],
  },
  {
    isoCode: 'LI',
    name: 'Liechtenstein',
    regions: [{ language: 'de', weight: 1, towns: ['Vaduz', 'Schaan', 'Balzers', 'Triesen', 'Eschen', 'Ruggell'], forms: ['AG', 'Anstalt'] }],
    carriers: ['Liechtensteinische Post', 'Planzer', 'DHL Express'],
  },
  {
    isoCode: 'LU',
    name: 'Luxembourg',
    regions: [{ language: 'fr', weight: 1, towns: ['Luxembourg', 'Esch-sur-Alzette', 'Differdange', 'Dudelange', 'Ettelbruck'], forms: ['S.à r.l.', 'S.A.'] }],
    carriers: ['POST Luxembourg', 'DHL', 'DPD'],
  },
  {
    isoCode: 'NL',
    name: 'Netherlands',
    regions: [{ language: 'nl', weight: 1, towns: ['Rotterdam', 'Utrecht', 'Eindhoven', 'Tilburg', 'Groningen', 'Breda', 'Nijmegen', 'Arnhem', 'Zwolle', 'Venlo'], forms: ['B.V.'] }],
    carriers: ['PostNL', 'DHL', 'DPD'],
  },
]

/** The countries the fixture already holds, which the demo's SQL does not insert again. */
export const FIXTURE_COUNTRIES: readonly string[] = ['CH', 'DE']

/** Where each tenant's customers are, by weight: tenant 1 mostly Swiss, tenant 2 mostly German. */
export const TENANT_COUNTRIES: Readonly<Record<1 | 2, ReadonlyArray<readonly [string, number]>>> = {
  1: [['CH', 60], ['DE', 12], ['AT', 8], ['FR', 7], ['IT', 7], ['LI', 6]],
  2: [['DE', 60], ['AT', 12], ['NL', 10], ['BE', 8], ['FR', 6], ['LU', 4]],
}

/** A company name's first word or words: a family name of the language. */
export const STEMS: Readonly<Record<Language, readonly string[]>> = {
  de: [
    'Ammann', 'Bachmann', 'Baumann', 'Berger', 'Brandt', 'Brunner', 'Egli', 'Fischer', 'Frei', 'Gerber',
    'Graf', 'Haas', 'Hartmann', 'Hofer', 'Huber', 'Kägi', 'Keller', 'Koch', 'Krüger', 'Kunz',
    'Lang', 'Lehmann', 'Lorenz', 'Lüthi', 'Maurer', 'Meier', 'Moser', 'Neumann', 'Roth', 'Schmid',
    'Schulze', 'Steiner', 'Vogel', 'Wagner', 'Weber', 'Widmer', 'Winkler', 'Wyss', 'Ziegler', 'Zimmermann',
  ],
  fr: [
    'Bertrand', 'Blanc', 'Bonnet', 'Chevalier', 'Dubois', 'Dupont', 'Faure', 'Favre', 'Fontaine', 'Fournier',
    'Garnier', 'Gauthier', 'Girard', 'Lambert', 'Lefèvre', 'Leroy', 'Marchand', 'Mercier', 'Michaud', 'Moreau',
    'Morel', 'Perrin', 'Renaud', 'Rochat', 'Rousseau', 'Roux',
  ],
  it: [
    'Barbieri', 'Bernasconi', 'Bianchi', 'Bruno', 'Colombo', 'Conti', 'Costa', 'De Luca', 'Ferrari', 'Fontana',
    'Galli', 'Gallo', 'Greco', 'Lombardi', 'Marino', 'Moretti', 'Ricci', 'Rinaldi', 'Romano', 'Rossi',
  ],
  nl: [
    'Bakker', 'Bos', 'Claes', 'De Boer', 'De Groot', 'De Vries', 'Dekker', 'Hendriks', 'Jansen', 'Janssens',
    'Maes', 'Meijer', 'Mulder', 'Peeters', 'Peters', 'Smit', 'Van Dijk', 'Verhoeven', 'Visser', 'Vos',
    'Willems', 'Wouters',
  ],
}

/** A company name's trade, in the language. */
export const TRADES: Readonly<Record<Language, readonly string[]>> = {
  de: [
    'Bau', 'Logistik', 'Elektro', 'Haustechnik', 'Holzbau', 'Metallbau', 'Druck', 'Verpackungen', 'Maschinenbau', 'Feinmechanik',
    'Sanitär', 'Handel', 'Transporte', 'Gartenbau', 'Medizintechnik', 'Lebensmittel', 'Getränke', 'Werkzeuge', 'Kunststofftechnik', 'Präzisionsteile',
    'Informatik', 'Büroservice',
  ],
  fr: [
    'Logistique', 'Bâtiment', 'Électricité', 'Emballages', 'Imprimerie', 'Transports', 'Mécanique', 'Menuiserie', 'Négoce', 'Distribution',
    'Alimentation', 'Textiles', 'Plastiques', 'Outillage', 'Optique', 'Informatique', 'Chauffage', 'Horlogerie',
  ],
  it: [
    'Logistica', 'Costruzioni', 'Impianti', 'Imballaggi', 'Tipografia', 'Trasporti', 'Meccanica', 'Arredamenti', 'Commercio', 'Alimentari',
    'Tessuti', 'Plastica', 'Utensili', 'Ottica', 'Informatica',
  ],
  nl: [
    'Logistiek', 'Bouw', 'Elektrotechniek', 'Verpakkingen', 'Drukkerij', 'Transport', 'Machinebouw', 'Installatietechniek', 'Handel', 'Voeding',
    'Textiel', 'Kunststoffen', 'Gereedschappen', 'Optiek', 'Software',
  ],
}

/** The seller's staff: first and last names, combined once each. */
export const FIRST_NAMES: readonly string[] = [
  'Anna', 'Lukas', 'Sarah', 'Marco', 'Laura', 'Simon', 'Nina', 'Thomas', 'Elena', 'Reto',
  'Claudia', 'Stefan', 'Martina', 'Sophie', 'Luca', 'Chiara', 'Nicolas', 'Céline', 'Jonas', 'Lea',
  'Fabian', 'Sandra', 'Patrick', 'Andrea', 'Beat', 'Ursula', 'Matteo', 'Julia',
]
export const LAST_NAMES: readonly string[] = [
  'Bühler', 'Caduff', 'Egger', 'Gisler', 'Hess', 'Imhof', 'Jost', 'Kälin', 'Marti', 'Nussbaumer',
  'Oberholzer', 'Pfister', 'Rüegg', 'Schärer', 'Tanner', 'Ulrich', 'Vogt', 'Wenger', 'Zbinden', 'Aebi',
  'Bossi', 'Crettenand', 'Dällenbach', 'Eberle', 'Fankhauser', 'Gilliéron', 'Hürlimann', 'Iten',
]

/** What a note on an order says, when it has one. */
export const NOTES: readonly string[] = [
  'Call before delivery',
  'Deliver to the loading dock',
  'Deliver to reception, ground floor',
  'Partial delivery accepted',
  'Invoice to head office',
  'Quote the order number on the invoice',
  'Delivery between 7 and 11 only',
  'Fragile: glass components',
  'Collect the empty pallets',
  'Ring the bell at gate 2',
  'Customer collects',
  'Confirm the delivery date by email',
]

/** A line's unit price, in cents: a price list of two decimals. */
export const UNIT_PRICES_CENTS: readonly number[] = [
  390, 490, 750, 1290, 1850, 2400, 3640, 4990, 6800, 8900, 12_900, 19_500, 24_900, 41_250, 68_500, 124_000,
]

/** A customer's credit limit, in cents, when it has one: 5,000.00 to 250,000.00 in steps. */
export const CREDIT_LIMITS_CENTS: readonly number[] = [
  5_000_00, 10_000_00, 15_000_00, 20_000_00, 25_000_00, 30_000_00, 40_000_00, 50_000_00, 75_000_00, 100_000_00, 150_000_00, 200_000_00, 250_000_00,
]
