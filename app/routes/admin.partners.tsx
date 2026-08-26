import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData } from "react-router";
import { requirePlatformAdmin } from "../admin/auth.server";
import db from "../db.server";
import { createPartner, getAvailablePartnerKeys, updatePartner } from "../admin/partner-management.server";
import { NICHE_CATEGORIES } from "../catalog/categories";

const INTEGRATION_TYPES = ["REST", "SFTP", "MOCK"];
const PRICING_FEED_FORMATS = ["API", "CSV", "MANUAL"];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  requirePlatformAdmin(request);

  const [partners, availablePartnerKeys] = await Promise.all([
    db.partner.findMany({
      orderBy: { name: "asc" },
      include: { _count: { select: { merchants: true, products: true } } },
    }),
    getAvailablePartnerKeys(),
  ]);

  return {
    availablePartnerKeys,
    partners: partners.map((partner) => ({
      id: partner.id,
      partnerKey: partner.partnerKey,
      name: partner.name,
      integrationType: partner.integrationType,
      pricingFeedFormat: partner.pricingFeedFormat,
      supportedCategories: partner.supportedCategories,
      regions: partner.regions,
      slaHours: partner.slaHours,
      shippingEstimate: Number(partner.shippingEstimate),
      active: partner.active,
      merchantCount: partner._count.merchants,
      productCount: partner._count.products,
      hasCredentials: Boolean(partner.apiConfigEncrypted),
    })),
  };
};

function readPartnerInput(formData: FormData) {
  return {
    name: String(formData.get("name") ?? ""),
    integrationType: String(formData.get("integrationType") ?? "REST"),
    pricingFeedFormat: String(formData.get("pricingFeedFormat") ?? "API"),
    supportedCategories: formData.getAll("supportedCategories").map(String),
    regions: String(formData.get("regions") ?? "")
      .split(",")
      .map((region) => region.trim().toUpperCase())
      .filter(Boolean),
    slaHours: Number(formData.get("slaHours") ?? 0),
    shippingEstimate: Number(formData.get("shippingEstimate") ?? 0),
    configJson: String(formData.get("configJson") ?? "").trim() || undefined,
  };
}

export const action = async ({ request }: ActionFunctionArgs) => {
  requirePlatformAdmin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  try {
    if (intent === "create") {
      const partnerKey = String(formData.get("partnerKey") ?? "");
      await createPartner({ partnerKey, ...readPartnerInput(formData) });
      return { ok: true as const };
    }

    if (intent === "update") {
      const partnerId = String(formData.get("partnerId"));
      await updatePartner(partnerId, { ...readPartnerInput(formData), active: formData.get("active") === "on" });
      return { ok: true as const };
    }
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }

  return null;
};

type LoaderData = Awaited<ReturnType<typeof loader>>;

function CategoryCheckboxes({
  name,
  defaultValues,
  ariaLabelledBy,
}: {
  name: string;
  defaultValues?: string[];
  ariaLabelledBy: string;
}) {
  return (
    <div role="group" aria-labelledby={ariaLabelledBy}>
      {NICHE_CATEGORIES.map((category) => (
        <label key={category.key} style={{ display: "inline-block", fontWeight: 400, marginRight: 12 }}>
          <input
            type="checkbox"
            name={name}
            value={category.key}
            defaultChecked={defaultValues?.includes(category.key)}
          />{" "}
          {category.label}
        </label>
      ))}
    </div>
  );
}

function NewPartnerForm({ availablePartnerKeys }: { availablePartnerKeys: string[] }) {
  const actionData = useActionData<typeof action>();

  if (availablePartnerKeys.length === 0) {
    return (
      <p className="muted">
        Every registered adapter (app/partners/registry.server.ts) already has a Partner row. Add a new adapter in
        code first (NFR-8), then it will show up here.
      </p>
    );
  }

  return (
    <Form method="post">
      <input type="hidden" name="intent" value="create" />
      {actionData && "error" in actionData && actionData.error && <p style={{ color: "#c00" }}>{actionData.error}</p>}

      <label htmlFor="new-partnerKey">Adapter (partnerKey)</label>
      <select id="new-partnerKey" name="partnerKey" required>
        {availablePartnerKeys.map((key) => (
          <option key={key} value={key}>
            {key}
          </option>
        ))}
      </select>

      <label htmlFor="new-name">Display name</label>
      <input id="new-name" type="text" name="name" required />

      <label htmlFor="new-integrationType">Integration type</label>
      <select id="new-integrationType" name="integrationType">
        {INTEGRATION_TYPES.map((type) => (
          <option key={type} value={type}>
            {type}
          </option>
        ))}
      </select>

      <label htmlFor="new-pricingFeedFormat">Pricing feed format</label>
      <select id="new-pricingFeedFormat" name="pricingFeedFormat">
        {PRICING_FEED_FORMATS.map((format) => (
          <option key={format} value={format}>
            {format}
          </option>
        ))}
      </select>

      <span id="new-categories-label" style={{ display: "block", margin: "8px 0 4px", fontSize: 13, fontWeight: 600 }}>
        Supported categories
      </span>
      <CategoryCheckboxes name="supportedCategories" ariaLabelledBy="new-categories-label" />

      <label htmlFor="new-regions">Regions (comma-separated, e.g. US, EU)</label>
      <input id="new-regions" type="text" name="regions" placeholder="US, EU" />

      <label htmlFor="new-slaHours">SLA (hours)</label>
      <input id="new-slaHours" type="number" name="slaHours" min={1} defaultValue={48} required />

      <label htmlFor="new-shippingEstimate">Shipping estimate ($)</label>
      <input id="new-shippingEstimate" type="number" name="shippingEstimate" min={0} step="0.01" defaultValue={0} />

      <label htmlFor="new-configJson">Adapter credentials (JSON, optional -- encrypted at rest)</label>
      <textarea id="new-configJson" name="configJson" rows={3} placeholder='{"apiKey": "..."}' />

      <button type="submit">Add partner</button>
    </Form>
  );
}

function PartnerRow({ partner }: { partner: LoaderData["partners"][number] }) {
  return (
    <details>
      <summary>
        <strong>{partner.name}</strong> <span className="badge">{partner.partnerKey}</span>{" "}
        {!partner.active && <span className="badge">inactive</span>} -- {partner.merchantCount} merchant(s),{" "}
        {partner.productCount} product(s)
      </summary>
      <Form method="post" style={{ marginTop: 12 }}>
        <input type="hidden" name="intent" value="update" />
        <input type="hidden" name="partnerId" value={partner.id} />

        <label htmlFor={`${partner.id}-name`}>Display name</label>
        <input id={`${partner.id}-name`} type="text" name="name" defaultValue={partner.name} required />

        <label htmlFor={`${partner.id}-integrationType`}>Integration type</label>
        <select id={`${partner.id}-integrationType`} name="integrationType" defaultValue={partner.integrationType}>
          {INTEGRATION_TYPES.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>

        <label htmlFor={`${partner.id}-pricingFeedFormat`}>Pricing feed format</label>
        <select
          id={`${partner.id}-pricingFeedFormat`}
          name="pricingFeedFormat"
          defaultValue={partner.pricingFeedFormat}
        >
          {PRICING_FEED_FORMATS.map((format) => (
            <option key={format} value={format}>
              {format}
            </option>
          ))}
        </select>

        <span
          id={`${partner.id}-categories-label`}
          style={{ display: "block", margin: "8px 0 4px", fontSize: 13, fontWeight: 600 }}
        >
          Supported categories
        </span>
        <CategoryCheckboxes
          name="supportedCategories"
          defaultValues={partner.supportedCategories}
          ariaLabelledBy={`${partner.id}-categories-label`}
        />

        <label htmlFor={`${partner.id}-regions`}>Regions (comma-separated)</label>
        <input id={`${partner.id}-regions`} type="text" name="regions" defaultValue={partner.regions.join(", ")} />

        <label htmlFor={`${partner.id}-slaHours`}>SLA (hours)</label>
        <input
          id={`${partner.id}-slaHours`}
          type="number"
          name="slaHours"
          min={1}
          defaultValue={partner.slaHours}
          required
        />

        <label htmlFor={`${partner.id}-shippingEstimate`}>Shipping estimate ($)</label>
        <input
          id={`${partner.id}-shippingEstimate`}
          type="number"
          name="shippingEstimate"
          min={0}
          step="0.01"
          defaultValue={partner.shippingEstimate}
        />

        <label>
          <input type="checkbox" name="active" defaultChecked={partner.active} /> Active
        </label>

        <label htmlFor={`${partner.id}-configJson`}>
          Adapter credentials (JSON) -- {partner.hasCredentials ? "currently set" : "not set"}, leave blank to keep
        </label>
        <textarea id={`${partner.id}-configJson`} name="configJson" rows={3} placeholder='{"apiKey": "..."}' />

        <button type="submit">Save</button>
      </Form>
    </details>
  );
}

export default function AdminPartners() {
  const { partners, availablePartnerKeys } = useLoaderData<typeof loader>();

  return (
    <div>
      <h2>Partners</h2>
      <p className="muted">{partners.length} partner(s) onboarded.</p>
      {partners.map((partner) => (
        <PartnerRow key={partner.id} partner={partner} />
      ))}

      <fieldset>
        <legend>Onboard a new partner (FR-7.1)</legend>
        <NewPartnerForm availablePartnerKeys={availablePartnerKeys} />
      </fieldset>
    </div>
  );
}
