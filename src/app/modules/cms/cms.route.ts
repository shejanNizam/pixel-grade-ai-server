import { Router } from "express";
import { checkAuth } from "../../middlewares/checkAuth";
import validateRequest from "../../middlewares/validateRequest";
import { UserRole } from "../user/user.interface";
import { CmsControllers } from "./cms.controller";
import { updateCmsPageZodSchema } from "./cms.validation";

const router = Router();

/**
 * @swagger
 * /cms:
 *   get:
 *     tags: [CMS]
 *     summary: List all pages with their last editor (admin only)
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: All CMS pages
 *       403:
 *         description: Forbidden — insufficient role
 */
router.get(
  "/",
  checkAuth(UserRole.admin, UserRole.super_admin),
  CmsControllers.getAllPages,
);

/**
 * @swagger
 * /cms/{slug}:
 *   get:
 *     tags: [CMS]
 *     summary: Get a public page (about, terms, or privacy)
 *     parameters:
 *       - in: path
 *         name: slug
 *         required: true
 *         schema:
 *           type: string
 *           enum: [about, terms, privacy]
 *     responses:
 *       200:
 *         description: Page content
 *       400:
 *         description: Unknown slug
 *       404:
 *         description: Page not found
 *   patch:
 *     tags: [CMS]
 *     summary: Edit a page (admin only)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: slug
 *         required: true
 *         schema:
 *           type: string
 *           enum: [about, terms, privacy]
 *     responses:
 *       200:
 *         description: Page updated
 *       403:
 *         description: Forbidden — insufficient role
 */
router.get("/:slug", CmsControllers.getPage);

router.patch(
  "/:slug",
  checkAuth(UserRole.admin, UserRole.super_admin),
  validateRequest(updateCmsPageZodSchema),
  CmsControllers.updatePage,
);

export const CmsRoutes = router;
