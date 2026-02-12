
// This file can be ignored or closed during code reviews/presentations.
// It contains a list of words strictly for moderation purposes.

const BASE_ABUSIVE_WORDS = [
    // English (Standard)
    'idiot', 'stupid', 'scam', 'fraud', 'cheat', 'fake', 'dumb', 'clown',
    'hate', 'kill', 'die', 'abuse', 'bastard', 'asshole', 'bitch', 'fuck', 'shit',
    'sex', 'nude', 'naked',

    // Hindi / Hinglish (Regional)
    'kutte', 'kutta', 'kamine', 'kamina', 'saala', 'haramkhor', 'madarchod', 'bhenchod',
    'chutiya', 'bhosdike', 'randi', 'gand', 'lauda', 'loda', 'teri maa', 'tera baap',

    // Gujarati / Gujlish (Regional)
    'gando', 'gandi', 'halkat', 'fokni', 'buch', 'bhooch', 'bewakoof', 'nalayak'
];

module.exports = { BASE_ABUSIVE_WORDS };

const CONTACT_PATTERNS = {
    // Phone: Matches Indian +91, 0-prefixed, or standard 10-digit starting with 6-9. 
    // Also matches generic international formats to be safe.
    PHONE: /(?:(?:\+|0{0,2})91(\s*[\-]\s*)?|[0]?)?[6789]\d{9}|\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/g,

    // Email: Standard email pattern
    EMAIL: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,

    // Links: Matches http/https, www, and specific shortlinks like wa.me, t.me
    // explicitly blocking common social domains
    LINKS: /(https?:\/\/[^\s]+)|(www\.[^\s]+)|(\b(wa\.me|t\.me|telegram\.me|facebook\.com|instagram\.com|linkedin\.com)\/[^\s]*)/gi,

    // Social Handles: simplistic approach, can be noisy, so maybe keep it distinct or use with caution
    SOCIAL_HANDLES: /@[\w\d_.]+/g,

    // UPI IDs: important for anti-circumvention of payments
    UPI: /[\w\.\-_]+@[\w]+/g,

    // Explicit Keywords for taking it off-platform
    KEYWORD_TRIGGER: /\b(call me|message me|whatsapp|telegram|signal|viber|phone|mobile|number|contact)\b/i
};

module.exports = { BASE_ABUSIVE_WORDS, CONTACT_PATTERNS };
