import re


STOPWORDS = {
    "will",
    "the",
    "a",
    "an",
    "of",
    "to",
    "in",
    "on",
    "by",
    "for",
    "and",
    "or",
    "be",
    "win",
    "wins",
}


def infer_correlation_group(question: str, slug: str | None = None) -> str:
    text = f"{question} {slug or ''}".lower()
    normalized = re.sub(r"[^a-z0-9\s-]", " ", text)
    normalized = re.sub(r"\s+", " ", normalized).strip()

    cup_match = re.search(r"(\d{4})\s+([a-z]+)\s+(stanley cup|nba finals|world series|super bowl)", normalized)
    if cup_match:
        return "-".join(cup_match.groups()).replace(" ", "-")

    election_match = re.search(r"(\d{4}).*?(president|election|nomination|senate|house)", normalized)
    if election_match:
        return f"{election_match.group(1)}-{election_match.group(2)}"

    tokens = [token for token in normalized.split() if token not in STOPWORDS and not token.isdigit()]
    return "-".join(tokens[:5]) if tokens else "uncategorized"
