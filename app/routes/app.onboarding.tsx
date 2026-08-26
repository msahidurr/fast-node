import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, redirect, useLoaderData, useNavigation } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { getOrCreateMerchant } from "../models/merchant.server";
import { NICHE_CATEGORIES } from "../catalog/categories";

type Step = "categories" | "partners" | "markup" | "done";

function resolveStep(
  merchant: { selectedCategories: string[]; onboardingCompletedAt: Date | null },
  requestedStep: string | null,
  connectedPartnerCount: number,
): Step {
  if (requestedStep === "categories" || requestedStep === "partners" || requestedStep === "markup") {
    return requestedStep;
  }
  if (merchant.selectedCategories.length === 0) return "categories";
  if (connectedPartnerCount === 0) return "partners";
  if (!merchant.onboardingCompletedAt) return "markup";
  return "done";
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const merchant = await getOrCreateMerchant(session.shop);
  const connections = await db.merchantPartner.findMany({ where: { merchantId: merchant.id } });

  const url = new URL(request.url);
  const step = resolveStep(merchant, url.searchParams.get("step"), connections.length);

  const availablePartners =
    step === "partners"
      ? await db.partner.findMany({
          where: { active: true, supportedCategories: { hasSome: merchant.selectedCategories } },
        })
      : [];

  const connectedPartnerNames = connections.length
    ? (
        await db.partner.findMany({
          where: { id: { in: connections.map((connection) => connection.partnerId) } },
        })
      ).map((partner) => partner.name)
    : [];

  return {
    step,
    merchant: {
      selectedCategories: merchant.selectedCategories,
      defaultMarkupType: merchant.defaultMarkupType,
      defaultMarkupValue: Number(merchant.defaultMarkupValue),
    },
    connectedPartnerNames,
    availablePartners: availablePartners.map((partner) => ({
      id: partner.id,
      name: partner.name,
      integrationType: partner.integrationType,
      slaHours: partner.slaHours,
    })),
    categories: NICHE_CATEGORIES,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const merchant = await getOrCreateMerchant(session.shop);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "categories") {
    const categories = formData.getAll("categories").map(String);
    await db.merchant.update({ where: { id: merchant.id }, data: { selectedCategories: categories } });
    return redirect("/app/onboarding?step=partners");
  }

  if (intent === "partners") {
    const partnerIds = formData.getAll("partnerIds").map(String);
    await db.merchantPartner.deleteMany({ where: { merchantId: merchant.id } });
    if (partnerIds.length > 0) {
      await db.merchantPartner.createMany({
        data: partnerIds.map((partnerId) => ({ merchantId: merchant.id, partnerId })),
        skipDuplicates: true,
      });
    }
    return redirect("/app/onboarding?step=markup");
  }

  if (intent === "markup") {
    const markupType = String(formData.get("markupType") ?? "PERCENTAGE");
    const markupValue = Number(formData.get("markupValue") ?? 0);
    await db.merchant.update({
      where: { id: merchant.id },
      data: { defaultMarkupType: markupType, defaultMarkupValue: markupValue, onboardingCompletedAt: new Date() },
    });
    return redirect("/app/catalog");
  }

  return null;
};

export default function Onboarding() {
  const { step, merchant, connectedPartnerNames, availablePartners, categories } = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  return (
    <s-page heading="Set up your fulfillment network">
      {step === "categories" && (
        <s-section heading="1. Choose your niche categories">
          <s-paragraph>Pick the product categories you want to sell. You can change this later.</s-paragraph>
          <Form method="post">
            <input type="hidden" name="intent" value="categories" />
            <s-choice-list name="categories" label="Niche categories" multiple>
              {categories.map((category) => (
                <s-choice key={category.key} value={category.key}>
                  {category.label}
                </s-choice>
              ))}
            </s-choice-list>
            <s-button type="submit" variant="primary" {...(isSubmitting ? { loading: true } : {})}>
              Continue
            </s-button>
          </Form>
        </s-section>
      )}

      {step === "partners" && (
        <s-section heading="2. Connect fulfillment partners">
          <s-paragraph>
            These partners cover the categories you picked
            {merchant.selectedCategories.length > 0 ? `: ${merchant.selectedCategories.join(", ")}` : ""}.
          </s-paragraph>
          {connectedPartnerNames.length > 0 && (
            <s-paragraph>Currently connected: {connectedPartnerNames.join(", ")}</s-paragraph>
          )}
          {availablePartners.length === 0 ? (
            <s-banner tone="warning" heading="No partners available yet">
              <s-paragraph>No partners currently support the categories you chose.</s-paragraph>
            </s-banner>
          ) : (
            <Form method="post">
              <input type="hidden" name="intent" value="partners" />
              <s-choice-list name="partnerIds" label="Partners" multiple>
                {availablePartners.map((partner) => (
                  <s-choice key={partner.id} value={partner.id}>
                    {partner.name} ({partner.integrationType}, {partner.slaHours}h SLA)
                  </s-choice>
                ))}
              </s-choice-list>
              <s-button type="submit" variant="primary" {...(isSubmitting ? { loading: true } : {})}>
                Continue
              </s-button>
            </Form>
          )}
        </s-section>
      )}

      {step === "markup" && (
        <s-section heading="3. Set your default markup">
          <s-paragraph>Applied to every product you import, unless overridden per-product (Phase 3).</s-paragraph>
          <Form method="post">
            <input type="hidden" name="intent" value="markup" />
            <s-select name="markupType" label="Markup type" value={merchant.defaultMarkupType}>
              <s-option value="PERCENTAGE">Percentage</s-option>
              <s-option value="FIXED">Fixed amount</s-option>
            </s-select>
            <s-number-field
              name="markupValue"
              label="Markup value"
              value={String(merchant.defaultMarkupValue)}
              min={0}
              step={0.01}
            />
            <s-button type="submit" variant="primary" {...(isSubmitting ? { loading: true } : {})}>
              Finish setup
            </s-button>
          </Form>
        </s-section>
      )}

      {step === "done" && (
        <s-section heading="You're all set">
          <s-paragraph>
            Onboarding is complete. Head to the <s-link href="/app/catalog">catalog</s-link> to import products.
          </s-paragraph>
        </s-section>
      )}
    </s-page>
  );
}
