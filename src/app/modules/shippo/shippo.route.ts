import { Router } from "express";
import { checkAuth } from "../../middlewares/checkAuth";
import { UserRole } from "../user/user.interface";
import { ShippoController } from "./shippo.controller";

const router = Router();
const anyUser = Object.values(UserRole);

router.use(checkAuth(...anyUser));

router.post("/validate-address", ShippoController.validateAddress);
router.post("/rates", ShippoController.getRates);

export const shippoRoutes = router;
