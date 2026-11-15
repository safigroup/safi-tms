export type Lang = "en" | "fr";

// Read on the server (app/page.tsx) so a returning visitor's choice is
// rendered straight away, with no flash of the other language.
export const LANG_COOKIE = "safi_lang";

// The sales team's WhatsApp numbers. `wa` is the number as wa.me wants it:
// digits only, country code first.
export const WHATSAPP = [
  { country: { en: "Tanzania", fr: "Tanzanie" }, display: "+255 745 931 016", wa: "255745931016" },
  { country: { en: "Zambia", fr: "Zambie" }, display: "+260 978 731 593", wa: "260978731593" },
] as const;

// Screen names (Overview, Board, Cost docket, Billing, Cashbook, Reports,
// Estimator) stay in English in both languages: they are the labels the
// signed-in app actually shows.

const en = {
  meta: {
    title: "Safi TMS — Transport management for East & Central African hauliers",
    description:
      "Track every truck border by border, log costs in TZS, ZMW, CDF, RWF, ZAR or USD, invoice on milestones and see the profit on every trip and truck. Request a demo.",
  },
  header: {
    tagline: "Transport management",
    language: "Language",
    signIn: "Sign in",
    requestDemo: "Request a demo",
    navHow: "How it works",
    navFaq: "Questions",
  },
  hero: {
    eyebrow: "For hauliers on the East & Central African corridors",
    titleLead: "Know every trip's ",
    titleAccent: "profit",
    titleTail: " before the truck comes home.",
    lede:
      "Safi TMS follows each truck border by border, turns costs paid in shillings, kwacha and francs into dollars the day they're spent, and tells you what you can invoice today. One screen, shared by your whole office.",
    primary: "Request a demo",
    secondary: "See how it works",
    reassurance: "A walkthrough on your own routes, in English or French. No commitment.",
    credibility: "Built inside a working haulage fleet on the Dar es Salaam corridors.",
    liveCaption: "A trip on the Board, with illustrative data.",
  },
  facts: [
    { v: "6 currencies", k: "TZS · ZMW · CDF · RWF · ZAR · USD, converted and locked" },
    { v: "Every border", k: "Arrival, clearance and waiting time at each crossing" },
    { v: "EN / FR", k: "Invoices, statements and reports in English or French" },
    { v: "Any phone", k: "Runs in the browser, so there's nothing to install" },
  ],
  pains: {
    kicker: "Sound familiar?",
    title: "Run the corridor, not the spreadsheet.",
    before: "Today",
    after: "With Safi TMS",
    rows: [
      {
        before: "Trip costs come in on WhatsApp, and the receipts stay in the driver's pocket.",
        after: "Your team logs each cost the day it's paid, from a phone, with a photo of the receipt.",
      },
      {
        before: "You find out a trip lost money at month-end, if at all.",
        after: "The margin updates with every cost, while the truck is still on the road.",
      },
      {
        before: "Shillings, kwacha and francs get converted on a calculator.",
        after: "Every amount is converted to dollars at the rate on file, then locked.",
      },
      {
        before: "A truck sits at Kasumbalesa for days before anyone tells you.",
        after: "Any truck waiting a day or more at a border is flagged on your Overview.",
      },
      {
        before: "Invoices go out late because nobody knew the truck had crossed.",
        after: "Billing shows which payment milestones you can invoice today.",
      },
      {
        before: "To plan a load, you phone around to find a free truck.",
        after: "The trip form shows which trucks are free and which are already on a trip.",
      },
    ],
  },
  overview: {
    kicker: "Every morning",
    module: "Overview",
    title: "Your whole operation on one page",
    body:
      "The Overview counts your trips by stage and lists the ones that need you: running late, stuck at a border, delivered without a POD, or on the road with no costs logged. Each one opens straight onto the trip.",
    bullets: [
      "This month against last month: revenue, costs, margin and cash collected",
      "What you can invoice right now, and who owes you the most",
      "Owners and finance see the money; operations see the trips",
    ],
    caption: "The Overview, with illustrative data.",
  },
  flow: {
    kicker: "How it works",
    title: "One trip, from quote to cash",
    lede: "Follow a load through Safi TMS, from the price you quote to the last payment.",
    caption: "Illustrative data.",
    steps: [
      {
        id: "dispatch",
        label: "Quote & dispatch",
        module: "Estimator · Board",
        title: "Price and dispatch a load in a minute",
        body:
          "Choose the customer and route, and the price fills in from their rate card. The truck list shows which trucks are free and which are already on a trip, and picking a truck brings its usual driver with it.",
        bullets: [
          "Rate cards per customer, route and commodity: per trip, per tonne or per m³",
          "Quote a new load from your route costs and see the margin before you say yes",
          "Several trucks for the same customer, entered in one go",
        ],
      },
      {
        id: "road",
        label: "On the road",
        module: "Cost docket",
        title: "Every cost, in its own currency, the day it's spent",
        body:
          "Fuel, border fees and allowances are logged from a phone in the currency paid, with a photo of the receipt. Each amount is converted to dollars at the rate on file and locked, so past trips never shift.",
        bullets: [
          "TZS, ZMW, CDF, RWF, ZAR or USD, with rates that refresh automatically",
          "Trip budgets: money sent against money spent, so overspending shows at once",
          "Fuel price per litre and empty return legs, tracked",
        ],
      },
      {
        id: "border",
        label: "At the border",
        module: "Board · Overview",
        title: "See which borders are costing you days",
        body:
          "Each trip shows its route border by border: where the truck is, how long it waited at each crossing, and its day against the corridor target. The Overview averages every crossing, so you can see where the time goes.",
        bullets: [
          "Average and longest wait at each border",
          "Trucks waiting at a border right now, and for how long",
          "Each trip's full history: who did what, and when",
        ],
      },
      {
        id: "billing",
        label: "Bill & collect",
        module: "Billing · Cashbook",
        title: "Invoice on time, and know where the cash is",
        body:
          "Payment schedules (on loading, at the border, on delivery) tell Billing exactly what you can invoice today. Aging shows who owes what, and the cashbook keeps your bank, mobile money and cash balances in one place.",
        bullets: [
          "Invoices and statements in English or French",
          "Proof of delivery and cargo papers kept with the trip",
          "Bank, mobile money and cash accounts, in any of your currencies",
        ],
      },
      {
        id: "review",
        label: "Review",
        module: "Overview · Reports",
        title: "Know which trucks and routes make money",
        body:
          "Trends show revenue against costs month by month, margin by route and profit per truck. Each truck's report adds its profit and loss, costs by category, fuel price per litre, and when it will pay back what you paid for it.",
        bullets: [
          "The last 3, 6 or 12 months at a glance",
          "Idle trucks, and how long they've been free",
          "Truck reports print in English or French",
        ],
      },
    ],
  },
  band: {
    title: "Your trucks are on the road right now. Do you know what each one is earning?",
    cta: "Request a demo",
  },
  trust: {
    kicker: "Security",
    title: "Your data stays yours",
    items: [
      {
        title: "Separate by design",
        body: "Each company's trips, costs and invoices are walled off from every other company on the platform.",
      },
      {
        title: "Roles that match your office",
        body: "Owner, admin, operations, finance or view-only: each person can change only what their job needs.",
      },
      {
        title: "Every edit on record",
        body: "Changes to trips and costs are logged field by field, with who made them and when.",
      },
    ],
  },
  faq: {
    kicker: "Questions",
    title: "Common questions",
    items: [
      {
        q: "Does my team need to install an app?",
        a: "No. Safi TMS runs in the web browser of any smartphone or computer. Costs can be logged from a phone with a photo of the receipt, and if the signal drops mid-entry, what was typed is kept on the phone.",
      },
      {
        q: "Which currencies and corridors does it handle?",
        a: "Costs can be entered in TZS, ZMW, CDF, RWF, ZAR or USD, and everything is reported in dollars. You set up your own routes, borders and target days, so it fits whichever corridors you run.",
      },
      {
        q: "Is it available in French?",
        a: "Invoices, statements, trip ledgers, truck reports and estimates print in English or French, French by default for customers in the DRC. The app's screens are in English.",
      },
      {
        q: "Who in my office sees what?",
        a: "Each person gets a role: owner, admin, operations, finance or view-only. Only owners, admins and finance see the cashbook and the money on the Overview, and every change to a trip or cost is logged with who made it.",
      },
      {
        q: "How do we get started?",
        a: "Request a demo below, or message us on WhatsApp. We'll walk you through Safi TMS on your own routes. If it's a fit, we set up your company's workspace and you invite your team.",
      },
    ],
  },
  whatsapp: {
    hero: "Or message us on WhatsApp:",
    lead: "Prefer WhatsApp?",
    body: "Message us directly, in English or French.",
    greeting: "Hello Safi TMS, I'd like to see a demo.",
    footer: "WhatsApp",
  },
  demo: {
    kicker: "Get started",
    title: "See Safi TMS on your own corridor",
    lede: "Tell us a little about your fleet. We'll get in touch to arrange a walkthrough with your routes, borders and currencies.",
    next: [
      "We get back to you to agree a time.",
      "We walk you through Safi TMS using your own routes and currencies.",
      "If it's a fit, we set up your company's workspace, and you invite your team from there.",
    ],
    form: {
      title: "Request a demo",
      name: "Your name",
      company: "Company",
      email: "Email",
      phone: "Phone or WhatsApp",
      contactHint: "Email or phone — at least one.",
      country: "Country",
      fleetSize: "Fleet size",
      choose: "Select…",
      message: "What would you like to see? (optional)",
      submit: "Request a demo",
      sending: "Sending…",
      sent: "Thank you — your request is in. We'll be in touch.",
      errors: {
        name_required: "Please enter your name.",
        company_required: "Please enter your company.",
        contact_required: "Add an email or a phone number so we can reach you.",
        invalid_email: "That email address doesn't look right.",
        invalid_phone: "That phone number doesn't look right.",
        rate_limited: "Too many requests from this connection — please try again in an hour.",
        failed: "Something went wrong — please try again.",
        invalid: "Something went wrong — please try again.",
      },
    },
  },
  sticky: {
    cta: "Request a demo",
    note: "See it on your own routes",
  },
  footer: {
    tagline: "Transport management for hauliers",
    signIn: "Sign in",
  },
};

export type LandingCopy = typeof en;

const fr: LandingCopy = {
  meta: {
    title: "Safi TMS — Gestion de transport pour les transporteurs d'Afrique de l'Est et centrale",
    description:
      "Suivez chaque camion frontière après frontière, saisissez vos coûts en TZS, ZMW, CDF, RWF, ZAR ou USD, facturez par étapes et voyez le bénéfice de chaque voyage et de chaque camion. Demandez une démo.",
  },
  header: {
    tagline: "Gestion de transport",
    language: "Langue",
    signIn: "Se connecter",
    requestDemo: "Demander une démo",
    navHow: "Comment ça marche",
    navFaq: "Questions",
  },
  hero: {
    eyebrow: "Pour les transporteurs des corridors d'Afrique de l'Est et centrale",
    titleLead: "Connaissez le ",
    titleAccent: "bénéfice",
    titleTail: " de chaque voyage avant le retour du camion.",
    lede:
      "Safi TMS suit chaque camion frontière après frontière, convertit en dollars le jour même les dépenses payées en shillings, en kwachas ou en francs, et vous indique ce que vous pouvez facturer aujourd'hui. Un seul écran, partagé par tout votre bureau.",
    primary: "Demander une démo",
    secondary: "Voir comment ça marche",
    reassurance: "Une démonstration sur vos propres itinéraires, en français ou en anglais. Sans engagement.",
    credibility: "Conçu au sein d'une flotte de transport en activité sur les corridors de Dar es Salaam.",
    liveCaption: "Un voyage sur le Board, avec des données d'illustration.",
  },
  facts: [
    { v: "6 devises", k: "TZS · ZMW · CDF · RWF · ZAR · USD, converties puis figées" },
    { v: "Chaque frontière", k: "Arrivée, dédouanement et attente à chaque passage" },
    { v: "FR / EN", k: "Factures, relevés et rapports en français ou en anglais" },
    { v: "Tout téléphone", k: "Fonctionne dans le navigateur : rien à installer" },
  ],
  pains: {
    kicker: "Ça vous parle ?",
    title: "Pilotez le corridor, pas le tableur.",
    before: "Aujourd'hui",
    after: "Avec Safi TMS",
    rows: [
      {
        before: "Les coûts arrivent par WhatsApp, et les reçus restent dans la poche du chauffeur.",
        after: "Votre équipe saisit chaque coût le jour où il est payé, depuis un téléphone, avec la photo du reçu.",
      },
      {
        before: "Vous découvrez en fin de mois qu'un voyage a perdu de l'argent, quand vous le découvrez.",
        after: "La marge se met à jour à chaque coût, pendant que le camion roule encore.",
      },
      {
        before: "Shillings, kwachas et francs sont convertis à la calculatrice.",
        after: "Chaque montant est converti en dollars au taux en vigueur, puis figé.",
      },
      {
        before: "Un camion attend à Kasumbalesa depuis des jours avant que quelqu'un vous prévienne.",
        after: "Tout camion qui attend depuis un jour ou plus à une frontière est signalé sur votre Overview.",
      },
      {
        before: "Les factures partent en retard parce que personne ne savait que le camion avait passé la frontière.",
        after: "Billing indique les échéances que vous pouvez facturer aujourd'hui.",
      },
      {
        before: "Pour planifier un chargement, vous appelez partout pour trouver un camion libre.",
        after: "Le formulaire de voyage indique quels camions sont libres et lesquels sont déjà en voyage.",
      },
    ],
  },
  overview: {
    kicker: "Chaque matin",
    module: "Overview",
    title: "Toute votre activité sur une seule page",
    body:
      "L'Overview compte vos voyages par étape et liste ceux qui demandent votre attention : en retard, bloqués à une frontière, livrés sans preuve de livraison, ou sur la route sans aucun coût saisi. Chacun s'ouvre directement sur le voyage.",
    bullets: [
      "Ce mois-ci face au mois dernier : recettes, coûts, marge et encaissements",
      "Ce que vous pouvez facturer tout de suite, et qui vous doit le plus",
      "Direction et finance voient les chiffres ; les opérations voient les voyages",
    ],
    caption: "L'Overview, avec des données d'illustration.",
  },
  flow: {
    kicker: "Comment ça marche",
    title: "Un voyage, du devis à l'encaissement",
    lede: "Suivez un chargement dans Safi TMS, du prix proposé au dernier paiement.",
    caption: "Données d'illustration.",
    steps: [
      {
        id: "dispatch",
        label: "Devis et affectation",
        module: "Estimator · Board",
        title: "Chiffrez et affectez un chargement en une minute",
        body:
          "Choisissez le client et l'itinéraire : le prix se remplit depuis sa grille tarifaire. La liste des camions indique ceux qui sont libres et ceux déjà en voyage, et le chauffeur habituel suit le camion choisi.",
        bullets: [
          "Grilles tarifaires par client, itinéraire et marchandise : au voyage, à la tonne ou au m³",
          "Chiffrez un nouveau chargement à partir de vos coûts par itinéraire, et voyez la marge avant de dire oui",
          "Plusieurs camions pour le même client, saisis d'un seul coup",
        ],
      },
      {
        id: "road",
        label: "Sur la route",
        module: "Cost docket",
        title: "Chaque coût, dans sa devise, le jour même",
        body:
          "Carburant, frais de frontière et indemnités se saisissent depuis un téléphone, dans la devise payée, avec la photo du reçu. Chaque montant est converti en dollars au taux en vigueur puis figé : les voyages passés ne bougent plus.",
        bullets: [
          "TZS, ZMW, CDF, RWF, ZAR ou USD, avec des taux mis à jour automatiquement",
          "Budgets de voyage : l'argent envoyé face à l'argent dépensé, pour repérer tout dépassement",
          "Prix du carburant au litre et retours à vide, suivis",
        ],
      },
      {
        id: "border",
        label: "À la frontière",
        module: "Board · Overview",
        title: "Voyez quelles frontières vous coûtent des jours",
        body:
          "Chaque voyage affiche son itinéraire frontière par frontière : où se trouve le camion, combien de temps il a attendu à chaque passage, et son jour face au délai du corridor. L'Overview fait la moyenne de tous les passages, pour voir où passe le temps.",
        bullets: [
          "Attente moyenne et maximale à chaque frontière",
          "Les camions qui attendent à une frontière en ce moment, et depuis combien de temps",
          "L'historique complet de chaque voyage : qui a fait quoi, et quand",
        ],
      },
      {
        id: "billing",
        label: "Facturation et encaissement",
        module: "Billing · Cashbook",
        title: "Facturez à temps, et sachez où est l'argent",
        body:
          "Les échéanciers (au chargement, à la frontière, à la livraison) indiquent à Billing exactement ce que vous pouvez facturer aujourd'hui. Le suivi des retards montre qui doit quoi, et le Cashbook réunit vos soldes en banque, en mobile money et en caisse.",
        bullets: [
          "Factures et relevés en français ou en anglais",
          "Preuve de livraison et documents de cargaison rangés avec le voyage",
          "Comptes bancaires, mobile money et caisses, dans vos devises",
        ],
      },
      {
        id: "review",
        label: "Analyse",
        module: "Overview · Reports",
        title: "Sachez quels camions et itinéraires rapportent",
        body:
          "Les tendances montrent recettes et coûts mois par mois, la marge par itinéraire et le bénéfice par camion. Le rapport de chaque camion y ajoute son compte de résultat, ses coûts par catégorie, le prix du carburant au litre, et la date à laquelle il aura remboursé son prix d'achat.",
        bullets: [
          "Les 3, 6 ou 12 derniers mois d'un coup d'œil",
          "Les camions à l'arrêt, et depuis combien de temps",
          "Rapports camion imprimables en français ou en anglais",
        ],
      },
    ],
  },
  band: {
    title: "Vos camions roulent en ce moment. Savez-vous ce que chacun vous rapporte ?",
    cta: "Demander une démo",
  },
  trust: {
    kicker: "Sécurité",
    title: "Vos données restent les vôtres",
    items: [
      {
        title: "Cloisonné par conception",
        body: "Les voyages, coûts et factures de chaque entreprise sont isolés de ceux de toutes les autres entreprises de la plateforme.",
      },
      {
        title: "Des rôles à l'image de votre bureau",
        body: "Propriétaire, administrateur, opérations, finance ou lecture seule : chacun ne peut modifier que ce qui relève de son poste.",
      },
      {
        title: "Chaque modification tracée",
        body: "Les modifications des voyages et des coûts sont enregistrées champ par champ, avec leur auteur et leur date.",
      },
    ],
  },
  faq: {
    kicker: "Questions",
    title: "Questions fréquentes",
    items: [
      {
        q: "Mon équipe doit-elle installer une application ?",
        a: "Non. Safi TMS fonctionne dans le navigateur de n'importe quel smartphone ou ordinateur. Les coûts se saisissent depuis un téléphone avec la photo du reçu, et si le réseau coupe en pleine saisie, ce qui a été tapé reste sur le téléphone.",
      },
      {
        q: "Quelles devises et quels corridors ?",
        a: "Les coûts se saisissent en TZS, ZMW, CDF, RWF, ZAR ou USD, et tout est présenté en dollars. Vous définissez vos propres itinéraires, frontières et délais cibles : l'outil s'adapte aux corridors que vous exploitez.",
      },
      {
        q: "Est-ce disponible en français ?",
        a: "Factures, relevés, registres de voyage, rapports camion et devis s'impriment en français ou en anglais, en français par défaut pour vos clients en RDC. Les écrans de l'application sont en anglais.",
      },
      {
        q: "Qui voit quoi dans mon bureau ?",
        a: "Chaque personne a un rôle : propriétaire, administrateur, opérations, finance ou lecture seule. Seuls les propriétaires, administrateurs et la finance voient le Cashbook et les chiffres financiers de l'Overview, et chaque modification d'un voyage ou d'un coût est enregistrée avec son auteur.",
      },
      {
        q: "Comment démarrer ?",
        a: "Demandez une démo ci-dessous, ou écrivez-nous sur WhatsApp. Nous vous présentons Safi TMS sur vos propres itinéraires. Si cela vous convient, nous créons l'espace de votre entreprise et vous y invitez votre équipe.",
      },
    ],
  },
  whatsapp: {
    hero: "Ou écrivez-nous sur WhatsApp :",
    lead: "Vous préférez WhatsApp ?",
    body: "Écrivez-nous directement, en français ou en anglais.",
    greeting: "Bonjour Safi TMS, je souhaite voir une démo.",
    footer: "WhatsApp",
  },
  demo: {
    kicker: "Commencer",
    title: "Voyez Safi TMS sur votre propre corridor",
    lede: "Parlez-nous de votre flotte. Nous vous contacterons pour organiser une démonstration avec vos itinéraires, frontières et devises.",
    next: [
      "Nous revenons vers vous pour convenir d'un rendez-vous.",
      "Nous vous présentons Safi TMS avec vos propres itinéraires et devises.",
      "Si cela vous convient, nous créons l'espace de votre entreprise, et vous y invitez ensuite votre équipe.",
    ],
    form: {
      title: "Demander une démo",
      name: "Votre nom",
      company: "Entreprise",
      email: "E-mail",
      phone: "Téléphone ou WhatsApp",
      contactHint: "E-mail ou téléphone — au moins l'un des deux.",
      country: "Pays",
      fleetSize: "Taille de la flotte",
      choose: "Choisir…",
      message: "Qu'aimeriez-vous voir ? (facultatif)",
      submit: "Demander une démo",
      sending: "Envoi…",
      sent: "Merci — votre demande a bien été reçue. Nous vous recontacterons.",
      errors: {
        name_required: "Veuillez indiquer votre nom.",
        company_required: "Veuillez indiquer votre entreprise.",
        contact_required: "Indiquez un e-mail ou un numéro de téléphone pour que nous puissions vous joindre.",
        invalid_email: "Cette adresse e-mail semble incorrecte.",
        invalid_phone: "Ce numéro de téléphone semble incorrect.",
        rate_limited: "Trop de demandes depuis cette connexion — réessayez dans une heure.",
        failed: "Une erreur s'est produite — veuillez réessayer.",
        invalid: "Une erreur s'est produite — veuillez réessayer.",
      },
    },
  },
  sticky: {
    cta: "Demander une démo",
    note: "Sur vos propres itinéraires",
  },
  footer: {
    tagline: "Gestion de transport pour transporteurs",
    signIn: "Se connecter",
  },
};

export const COPY: Record<Lang, LandingCopy> = { en, fr };
