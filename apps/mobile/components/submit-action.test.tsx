import { fireEvent, render } from "@testing-library/react-native";
import { SubmitAction } from "./submit-action";

describe("SubmitAction", () => {
    it("is disabled and reports the sending reason while a request is pending", async () => {
        const onPress = jest.fn();
        const screen = await render(<SubmitAction pending disabledReason={null} onPress={onPress} />);
        const button = screen.getByRole("button", { name: "Send quote request" });

        expect(button).toBeDisabled();
        expect(screen.getByText("Sending your request. Please wait…")).toBeTruthy();
        fireEvent.press(button);
        expect(onPress).not.toHaveBeenCalled();
    });
});