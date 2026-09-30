# Decisions

## ADR 1: Typography choice

- Chosen: `Plus Jakarta Sans` for headings and `Inter` for body.
- Reason: close to the supplied design language and widely available via `next/font`.

## ADR 2: Default assumptions

- Minimum order: 40kg.
- Default lead time: 1 day.
- Delivery is manually quoted rather than automatically priced.
- Search icon remains hidden in v1 to match the design and scope.

## ADR 3: SQLModel compatibility

- Chosen: SQLModel `>=0.0.47,<0.1` instead of `0.0.24`.
- Reason: `0.0.24` fails runtime model construction with the current Pydantic 2.13 release; the current SQLModel release is compatible and passes schema creation checks.

## ADR 4: Outline icon library

- Chosen: `lucide-react` for site navigation, trust marks and action icons.
- Reason: it is the icon library specified for the outline style in the product design.

## ADR 5: Farm map link

- Chosen: leave `farm_maps_url` unset until the farm provides a verified pin.
- Reason: a generic region search could direct customers to the wrong pickup location.
