import { Router } from "express";
import { checkAuth } from "../../middlewares/checkAuth";
import { UserRole } from "../user/user.interface";
import { CartController } from "./cart.controller";

const router = Router();
const anyUser = Object.values(UserRole);

router.use(checkAuth(...anyUser));

router.get("/", CartController.getCart);
router.post("/add", CartController.addToCart);
router.delete("/items/:itemId", CartController.removeFromCart);
router.delete("/clear", CartController.clearCart);

export const cartRoutes = router;
