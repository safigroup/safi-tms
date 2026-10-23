export type Lang = "en" | "fr";

// Read on the server (app/page.tsx) so a returning visitor's choice is
// rendered straight away, with no flash of the other language.
export const LANG_COOKIE = "safi_lang";

const en = {
  meta: {
    title: "Safi TMS — Transport management for hauliers",
    description:
      "Trips, costs in any currency, milestone billing and per-truck profit for hauliers on the East and Central African corridors.",
  },
  header: {
    tagline: "Transport management",
    language: "Language",
    signIn: "Sign in",
    requestDemo: "Request a demo",
  },
  hero: {
    eyebrow: "For hauliers on the East & Central African corridors",
    titleLead: "Run the ",
    titleAccent: "corridor",
    titleTail: ", not the spreadsheet.",
    lede:
      "Safi TMS puts every trip, cost, invoice and truck on one board, so you know your margin while the truck is still on the road — not weeks after it's back.",
    primary: "Request a demo",
    secondary: "Sign in",
    credibility: "Built inside a working haulage fleet on the Dar es Salaam corridors.",
    mockCaption: "The Board, with illustrative data.",
  },
  points: {
    kicker: "Why Safi TMS",
    title: "Made for the realities of the corridor",
    items: [
      {
        title: "Margin per trip, live",
        body: "Revenue, costs and margin update as your crews log expenses on the road — not at month-end.",
      },
      {
        title: "Any currency in, dollars out",
        body: "Log costs in TZS, ZMW, CDF, RWF or USD. Each amount is converted at the rate on file and locked, so past trips never shift. Rates refresh automatically twice a month.",
      },
      {
        title: "Bill on milestones, not memory",
        body: "Payment schedules — on loading, at the border, on delivery — show exactly what you can invoice today, and aging shows who owes what.",
      },
      {
        title: "English or French, on every document",
        body: "Invoices, trip ledgers, truck reports and estimates print in either language — French by default for customers in the DRC.",
      },
    ],
  },
  flow: {
    kicker: "How it works",
    title: "One trip, from quote to cash",
    lede: "Five screens follow every load, from the first quote to the final payment.",
    steps: [
      {
        label: "Quote",
        module: "Estimator",
        body: "Price a load from your route cost templates and customer rate cards, and see the margin before you say yes.",
      },
      {
        label: "Dispatch",
        module: "Board",
        body: "Assign truck and driver, then follow each trip from loading through every border to delivery. Trips running past the corridor target are flagged.",
      },
      {
        label: "On the road",
        module: "Cost docket",
        body: "Crews log fuel, border fees and allowances in local currency, with a photo of the receipt. Empty return legs are tagged, so you see what they really cost.",
      },
      {
        label: "Deliver & bill",
        module: "Billing",
        body: "Record the proof of delivery, raise milestone invoices, log payments and spot overdue accounts at a glance.",
      },
      {
        label: "Review",
        module: "Reports",
        body: "Profit and loss per truck, costs by category, fuel per litre — and when each truck will pay back what you paid for it.",
      },
    ],
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
        body: "Owner, admin, operations, finance or view-only — each person can change only what their job needs.",
      },
      {
        title: "Every edit on record",
        body: "Changes to trips and costs are logged field by field, with who made them and when.",
      },
    ],
  },
  demo: {
    kicker: "Get started",
    title: "See it on your own routes",
    lede: "Tell us a little about your fleet and we'll get in touch to arrange a walkthrough.",
    next: [
      "We get back to you to agree a time.",
      "We walk you through Safi TMS using your own routes and currencies.",
      "If it's a fit, we set up your company's workspace — you invite your team from there.",
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
  footer: {
    tagline: "Transport management for hauliers",
    signIn: "Sign in",
  },
};

export type LandingCopy = typeof en;

const fr: LandingCopy = {
  meta: {
    title: "Safi TMS — Gestion de transport pour transporteurs",
    description:
      "Voyages, coûts multidevises, facturation par étapes et rentabilité par camion pour les transporteurs des corridors d'Afrique de l'Est et centrale.",
  },
  header: {
    tagline: "Gestion de transport",
    language: "Langue",
    signIn: "Se connecter",
    requestDemo: "Demander une démo",
  },
  hero: {
    eyebrow: "Pour les transporteurs des corridors d'Afrique de l'Est et centrale",
    titleLead: "Pilotez le ",
    titleAccent: "corridor",
    titleTail: ", pas le tableur.",
    lede:
      "Safi TMS réunit voyages, coûts, factures et camions sur un seul tableau de bord : vous connaissez votre marge pendant que le camion roule encore, et non des semaines après son retour.",
    primary: "Demander une démo",
    secondary: "Se connecter",
    credibility: "Conçu au sein d'une flotte de transport en activité sur les corridors de Dar es Salaam.",
    mockCaption: "Le Board, avec des données d'illustration.",
  },
  points: {
    kicker: "Pourquoi Safi TMS",
    title: "Pensé pour les réalités du corridor",
    items: [
      {
        title: "La marge de chaque voyage, en direct",
        body: "Recettes, coûts et marge se mettent à jour dès que vos équipes saisissent leurs dépenses sur la route — pas en fin de mois.",
      },
      {
        title: "Toutes les devises en entrée, des dollars en sortie",
        body: "Saisissez vos coûts en TZS, ZMW, CDF, RWF ou USD. Chaque montant est converti au taux en vigueur puis figé : les voyages passés ne bougent plus. Les taux se mettent à jour automatiquement deux fois par mois.",
      },
      {
        title: "Facturez par étapes, pas de mémoire",
        body: "Les échéanciers — au chargement, à la frontière, à la livraison — indiquent exactement ce qui est facturable aujourd'hui, et le suivi des retards montre qui doit quoi.",
      },
      {
        title: "Anglais ou français, sur chaque document",
        body: "Factures, registres de voyage, rapports camion et devis s'impriment dans l'une ou l'autre langue — en français par défaut pour vos clients en RDC.",
      },
    ],
  },
  flow: {
    kicker: "Comment ça marche",
    title: "Un voyage, du devis à l'encaissement",
    lede: "Cinq écrans suivent chaque chargement, du premier devis au dernier paiement.",
    steps: [
      {
        label: "Devis",
        module: "Estimator",
        body: "Chiffrez un chargement à partir de vos modèles de coûts par itinéraire et des grilles tarifaires clients, et voyez la marge avant de dire oui.",
      },
      {
        label: "Expédition",
        module: "Board",
        body: "Affectez camion et chauffeur, puis suivez chaque voyage du chargement à la livraison, frontière après frontière. Les voyages qui dépassent le délai du corridor sont signalés.",
      },
      {
        label: "Sur la route",
        module: "Cost docket",
        body: "Les équipes saisissent carburant, frais de frontière et indemnités en monnaie locale, avec la photo du reçu. Les retours à vide sont signalés, pour en connaître le vrai coût.",
      },
      {
        label: "Livraison et facturation",
        module: "Billing",
        body: "Enregistrez la preuve de livraison, émettez les factures par étape, saisissez les paiements et repérez les retards d'un coup d'œil.",
      },
      {
        label: "Analyse",
        module: "Reports",
        body: "Compte de résultat par camion, coûts par catégorie, carburant au litre — et la date à laquelle chaque camion aura remboursé son prix d'achat.",
      },
    ],
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
  demo: {
    kicker: "Commencer",
    title: "Voyez-le sur vos propres itinéraires",
    lede: "Parlez-nous de votre flotte et nous vous contacterons pour organiser une démonstration.",
    next: [
      "Nous revenons vers vous pour convenir d'un rendez-vous.",
      "Nous vous présentons Safi TMS avec vos propres itinéraires et devises.",
      "Si cela vous convient, nous créons l'espace de votre entreprise — vous y invitez ensuite votre équipe.",
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
  footer: {
    tagline: "Gestion de transport pour transporteurs",
    signIn: "Se connecter",
  },
};

export const COPY: Record<Lang, LandingCopy> = { en, fr };
