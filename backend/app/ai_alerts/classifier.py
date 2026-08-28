"""Alert classification -- decides what a raw ai/ detection means and who
needs to hear about it.

adapted to ai/'s actual payload shape
(class/confidence/bbox per detection, camera on the frame).
"""
from dataclasses import dataclass, field


_seuil_confiance_arme = 0.6


def definir_seuil_confiance_arme(valeur: float) -> None:
    global _seuil_confiance_arme
    _seuil_confiance_arme = valeur


def seuils() -> dict:
    """Lecture seule, pour les tests."""
    return {"confiance_arme": _seuil_confiance_arme}


@dataclass
class Decision:
    """action: "alarme" | "alerte_silencieuse" | "notification" | "aucune_action"
    severity: an AlertSeverity value, kept as a string to avoid importing
        the model here.
    critical_path: True if this event should eventually route through a
        physical alarm channel independent of the backend (buzzer/relay).
        No such hardware exists yet -- for now this only documents intent.
        Security decision, not cosmetic: fire/gas get an audible buzzer,
        weapons get a silent notification only (never a siren, to avoid
        alerting an armed person).
    """
    action: str
    severity: str
    title: str
    message: str
    notify_roles: list = field(default_factory=list)
    critical_path: bool = False


def classify_weapon(detection: dict, camera_id: str) -> Decision | None:
    """None below threshold -- never an "aucune_action" Decision for that
    case, to avoid writing an empty Alert row per silent frame."""
    confidence = detection.get("confidence", 0.0)
    if confidence < _seuil_confiance_arme:
        return None
    return Decision(
        action="alerte_silencieuse",
        severity="CRITICAL",
        title=f"Arme detectee ({detection.get('class', 'inconnu')})",
        message=(
            f"Camera {camera_id} : {detection.get('class')} detecte, "
            f"confidence={confidence:.2f}. Alerte silencieuse -- pas de buzzer "
            f"(decision 2026-07-27, voir smartagencyV1/CLAUDE.md : sonner une "
            f"alarme risquerait d'alerter la personne armee)."
        ),
        notify_roles=["SECURITY", "MANAGER"],
        critical_path=True,
    )


def classify_fire(detection: dict, camera_id: str) -> Decision:
    """No confidence threshold, unlike classify_weapon -- a fire/smoke
    signal is never ignored, even at low confidence."""
    return Decision(
        action="alarme",
        severity="CRITICAL",
        title=f"Feu/fumee detecte ({detection.get('class', 'inconnu')})",
        message=(
            f"Camera {camera_id} : {detection.get('class')} detecte, "
            f"confidence={detection.get('confidence', 0.0):.2f}. Priorite maximale -- "
            f"evacuation, agent de securite, pompiers si possible."
        ),
        notify_roles=["SECURITY", "MANAGER"],
        critical_path=True,
    )


def classify_wanted(detection: dict, camera_id: str) -> Decision:
    """`class` is already the matched person's name -- ai/ sends no
    separate person_id. `confidence` is cosine similarity, not a
    probability -- never render it as a percentage.

    No second confidence threshold here: ai/'s wanted.threshold is already
    the applied business threshold, hot-reloadable via PUT /wanted/threshold.
    Re-thresholding here would silently desync from what's actually running."""
    confidence = detection.get("confidence", 0.0)
    return Decision(
        action="notification",
        severity="HIGH",
        title=f"Personne recherchee : {detection.get('class', 'inconnu')}",
        message=(
            f"Camera {camera_id} : correspondance avec {detection.get('class')}, "
            f"similarite={confidence:.2f}. Pas sur le chemin critique -- "
            f"notification normale au manager."
        ),
        notify_roles=["MANAGER"],
        critical_path=False,
    )


CLASSIFIERS = {
    "weapon": classify_weapon,
    "fire": classify_fire,
    "wanted": classify_wanted,
    # emotion/zoning: no classifier yet, product decision pending.
}


def classify(feature: str, detection: dict, camera_id: str) -> Decision | None:
    fn = CLASSIFIERS.get(feature)
    if fn is None:
        return None
    return fn(detection, camera_id)
