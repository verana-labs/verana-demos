export const config = {
  issuerChatbotAdminUrl:
    process.env.NEXT_PUBLIC_ISSUER_CHATBOT_VS_ADMIN_URL || "",
  verifierChatbotAdminUrl:
    process.env.NEXT_PUBLIC_VERIFIER_CHATBOT_VS_ADMIN_URL || "",
  issuerWebUrl: process.env.NEXT_PUBLIC_ISSUER_WEB_URL || "",
  verifierWebUrl: process.env.NEXT_PUBLIC_VERIFIER_WEB_URL || "",
};
