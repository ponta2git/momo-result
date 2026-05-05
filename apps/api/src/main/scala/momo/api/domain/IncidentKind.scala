package momo.api.domain

/**
 * Pure domain enumeration of the 6 fixed incident categories that are recorded per player per
 * match. The mapping to DB seed values (`incident_masters.id`) lives in the repository layer and
 * is intentionally kept out of the domain.
 */
enum IncidentKind derives CanEqual:
  case Destination, PlusStation, MinusStation, CardStation, CardShop, SuriNoGinji
